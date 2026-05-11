/* supabase-storage.js - cloud file storage for ProjectFlow */
'use strict';

const SupabaseStorage = (() => {
  const CFG_KEY = 'pf_supabase_cfg';
  const CFG_BACKUP_KEY = 'pf_supabase_cfg_backup';
  const AI_CFG_KEY = 'pf_ai_cfg';
  const AI_CFG_BACKUP_KEY = 'pf_ai_cfg_backup';
  const DEFAULT_CFG = {
    url: 'https://vcevzevlozrazjpsrnyb.supabase.co',
    key: 'sb_publishable_rl5SmONDCrkFrRc5AxwEBA_pZQ7wwZx',
    bucket: 'projectflow-uploads'
  };
  const DEFAULT_AI_CFG = {
    ollamaKey: '',
    ollamaModel: 'gpt-oss:120b'
  };
  const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
  const MAX_PDF_BYTES = 8 * 1024 * 1024; // 8 MB
  let pdfLibLoader = null;

  function parseJson(raw) {
    try { return JSON.parse(raw || 'null'); } catch { return null; }
  }

  function getConfig() {
    const saved = parseJson(localStorage.getItem(CFG_KEY));
    if (saved?.url && saved?.key && saved?.bucket) return saved;

    const backup = parseJson(localStorage.getItem(CFG_BACKUP_KEY));
    if (backup?.url && backup?.key && backup?.bucket) {
      localStorage.setItem(CFG_KEY, JSON.stringify(backup));
      return backup;
    }

    return DEFAULT_CFG;
  }

  function setConfig(cfg) {
    const safe = {
      url: String(cfg?.url || '').trim(),
      key: String(cfg?.key || '').trim(),
      bucket: String(cfg?.bucket || '').trim() || 'projectflow-uploads'
    };
    localStorage.setItem(CFG_KEY, JSON.stringify(safe));
    localStorage.setItem(CFG_BACKUP_KEY, JSON.stringify(safe));
  }

  function clearConfig() {
    localStorage.removeItem(CFG_KEY);
    localStorage.removeItem(CFG_BACKUP_KEY);
  }

  function getAIConfig() {
    const saved = parseJson(localStorage.getItem(AI_CFG_KEY));
    if (saved) {
      return {
        ollamaKey: String(saved?.ollamaKey || ''),
        ollamaModel: String(saved?.ollamaModel || DEFAULT_AI_CFG.ollamaModel)
      };
    }

    const backup = parseJson(localStorage.getItem(AI_CFG_BACKUP_KEY));
    if (backup) {
      const out = {
        ollamaKey: String(backup?.ollamaKey || ''),
        ollamaModel: String(backup?.ollamaModel || DEFAULT_AI_CFG.ollamaModel)
      };
      localStorage.setItem(AI_CFG_KEY, JSON.stringify(out));
      return out;
    }

    return { ...DEFAULT_AI_CFG };
  }

  function setAIConfig(cfg) {
    const safe = {
      ollamaKey: String(cfg?.ollamaKey || ''),
      ollamaModel: String(cfg?.ollamaModel || DEFAULT_AI_CFG.ollamaModel)
    };
    localStorage.setItem(AI_CFG_KEY, JSON.stringify(safe));
    localStorage.setItem(AI_CFG_BACKUP_KEY, JSON.stringify(safe));
  }

  function isConfigured() {
    const cfg = getConfig();
    return !!(cfg && cfg.url && cfg.key && cfg.bucket);
  }

  function getClient() {
    if (!window.supabase || !window.supabase.createClient) return null;
    const cfg = getConfig();
    if (!cfg?.url || !cfg?.key) return null;
    return window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: false }
    });
  }

  function sanitizeName(name) {
    return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  function pathFromPublicUrl(url, bucket) {
    const marker = `/storage/v1/object/public/${bucket}/`;
    const idx = String(url || '').indexOf(marker);
    if (idx < 0) return null;
    return decodeURIComponent(String(url).slice(idx + marker.length));
  }

  async function optimizeImage(file, maxSide = 1600, quality = 0.72) {
    if (!file || !file.type || !file.type.startsWith('image/')) return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * scale));
    const h = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(bmp, 0, 0, w, h);

    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    if (!blob) return file;

    const out = new File([blob], sanitizeName(file.name).replace(/\.[^/.]+$/, '') + '.webp', {
      type: 'image/webp'
    });

    return out.size < file.size ? out : file;
  }

  async function optimizePdf(file) {
    if (!file || file.type !== 'application/pdf') return file;
    if (file.size <= 350 * 1024) return file;
    try {
      if (!pdfLibLoader) pdfLibLoader = import('https://esm.sh/pdf-lib@1.17.1');
      const { PDFDocument } = await pdfLibLoader;
      const src = await file.arrayBuffer();
      const pdf = await PDFDocument.load(src, { ignoreEncryption: true });
      const outBytes = await pdf.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
      const out = new File([outBytes], sanitizeName(file.name), { type: 'application/pdf' });
      return out.size < file.size ? out : file;
    } catch {
      return file;
    }
  }

  async function uploadFile(file, folder = 'uploads') {
    const cfg = getConfig();
    if (!cfg?.bucket) throw new Error('Supabase bucket no configurado');
    const client = getClient();
    if (!client) throw new Error('Cliente Supabase no disponible');

    const isPdf = file?.type === 'application/pdf' || /\.pdf$/i.test(String(file?.name || ''));
    if (isPdf && file.size > MAX_PDF_BYTES) {
      throw new Error('El PDF excede 8 MB. Para ahorrar espacio, reduce el archivo antes de subirlo.');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error('Archivo demasiado grande. Maximo permitido: 10 MB.');
    }

    let optimized = await optimizeImage(file);
    optimized = await optimizePdf(optimized);
    const name = sanitizeName(optimized?.name || 'file');
    const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${name}`;

    const { error } = await client.storage.from(cfg.bucket).upload(path, optimized, {
      upsert: false,
      contentType: optimized.type || 'application/octet-stream',
      cacheControl: '3600'
    });
    if (error) throw error;

    const { data } = client.storage.from(cfg.bucket).getPublicUrl(path);
    return { path, publicUrl: data?.publicUrl || '' };
  }

  async function deleteByStoredValue(storedValue) {
    const cfg = getConfig();
    if (!cfg?.bucket) return;
    const client = getClient();
    if (!client) return;

    const val = String(storedValue || '');
    const path = val.startsWith('http') ? pathFromPublicUrl(val, cfg.bucket) : val;
    if (!path) return;
    await client.storage.from(cfg.bucket).remove([path]);
  }

  function setStatus(msg, isError = false) {
    const el = document.getElementById('sbStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--text-muted)';
  }

  function fillSettingsForm() {
    const cfg = getConfig() || {};
    const urlEl = document.getElementById('sbUrl');
    const keyEl = document.getElementById('sbKey');
    const bucketEl = document.getElementById('sbBucket');
    const ollamaKeyEl = document.getElementById('ollamaKey');
    const ollamaModelEl = document.getElementById('ollamaModel');
    const aiCfg = getAIConfig();
    if (urlEl) urlEl.value = cfg.url || '';
    if (keyEl) keyEl.value = cfg.key || '';
    if (bucketEl) bucketEl.value = cfg.bucket || 'projectflow-uploads';
    if (ollamaKeyEl) ollamaKeyEl.value = aiCfg.ollamaKey || '';
    if (ollamaModelEl) ollamaModelEl.value = aiCfg.ollamaModel || DEFAULT_AI_CFG.ollamaModel;
    setStatus(isConfigured() ? 'Supabase activo para datos e imagenes.' : 'Sin configurar. Se usa almacenamiento local.');
  }

  async function saveFromInputs() {
    const url = document.getElementById('sbUrl')?.value?.trim();
    const key = document.getElementById('sbKey')?.value?.trim();
    const bucket = document.getElementById('sbBucket')?.value?.trim() || 'projectflow-uploads';
    const ollamaKey = document.getElementById('ollamaKey')?.value?.trim() || '';
    const ollamaModel = document.getElementById('ollamaModel')?.value?.trim() || DEFAULT_AI_CFG.ollamaModel;
    if (!url || !key || !bucket) {
      setStatus('Completa URL, key y bucket.', true);
      return;
    }
    setConfig({ url, key, bucket });
    setAIConfig({ ollamaKey, ollamaModel });
    setStatus('Configuracion guardada.');
  }

  function clearFromUI() {
    // Safety-first: restore from backup instead of erasing config.
    const backup = parseJson(localStorage.getItem(CFG_BACKUP_KEY));
    const aiBackup = parseJson(localStorage.getItem(AI_CFG_BACKUP_KEY));
    if (backup?.url && backup?.key && backup?.bucket) {
      localStorage.setItem(CFG_KEY, JSON.stringify(backup));
    } else {
      setConfig(DEFAULT_CFG);
    }
    if (aiBackup) {
      const safeAI = {
        ollamaKey: String(aiBackup?.ollamaKey || ''),
        ollamaModel: String(aiBackup?.ollamaModel || DEFAULT_AI_CFG.ollamaModel)
      };
      localStorage.setItem(AI_CFG_KEY, JSON.stringify(safeAI));
    } else {
      setAIConfig(DEFAULT_AI_CFG);
    }
    fillSettingsForm();
    setStatus('Configuracion restaurada.');
  }

  return {
    getConfig,
    setConfig,
    getClient,
    isConfigured,
    uploadFile,
    deleteByStoredValue,
    fillSettingsForm,
    saveFromInputs,
    clearFromUI,
    setStatus,
    getAIConfig,
    setAIConfig
  };
})();

if (typeof window !== 'undefined') {
  window.SupabaseStorage = SupabaseStorage;
}
