/* ai-descriptions.js - generate descriptions from titles */
'use strict';

const AIDescriptions = (() => {
  const inFlight = new Map();

  function byId(id) {
    return document.getElementById(id);
  }

  function isReadOnly() {
    return !!window.AppMode?.isReadOnly?.();
  }

  function fallbackDescription(title, kind) {
    const t = String(title || '').trim();
    if (!t) return '';
    if (kind === 'project') return `Proyecto enfocado en ${t.toLowerCase()}, con entregables claros y seguimiento continuo.`;
    if (kind === 'objective') return `Objetivo para ${t.toLowerCase()}, con alcance definido y criterio de avance medible.`;
    if (kind === 'daily') return `Actividad relacionada con ${t.toLowerCase()}, incluyendo acciones realizadas y resultado esperado.`;
    return `Descripcion generada para ${t.toLowerCase()}.`;
  }

  async function generateDescription(title, kind) {
    const cleanTitle = String(title || '').trim();
    if (!cleanTitle) return '';

    const key = `${kind}:${cleanTitle}`;
    if (inFlight.has(key)) return inFlight.get(key);

    const p = (async () => {
      const client = window.SupabaseStorage?.getClient?.();
      const aiCfg = window.SupabaseStorage?.getAIConfig?.() || {};
      if (!client) return fallbackDescription(cleanTitle, kind);

      try {
        const res = await client.functions.invoke('ai-generate-description', {
          body: {
            title: cleanTitle,
            kind,
            ollama_api_key: aiCfg.ollamaKey || undefined,
            ollama_model: aiCfg.ollamaModel || undefined
          }
        });
        if (res?.error) throw res.error;
        const description = String(res?.data?.description || '').trim();
        return description || fallbackDescription(cleanTitle, kind);
      } catch {
        return fallbackDescription(cleanTitle, kind);
      }
    })();

    inFlight.set(key, p);
    try {
      return await p;
    } finally {
      inFlight.delete(key);
    }
  }

  async function fill(cfg) {
    if (isReadOnly()) return;
    const titleEl = byId(cfg.titleId);
    const descEl = byId(cfg.descId);
    const btnEl = byId(cfg.btnId);
    if (!titleEl || !descEl) return;
    const title = String(titleEl.value || '').trim();
    if (!title) {
      UI.toast('Primero escribe el titulo', 'error');
      return;
    }

    if (btnEl) {
      btnEl.disabled = true;
      btnEl.textContent = 'Generando...';
    }

    try {
      const text = await generateDescription(title, cfg.kind);
      if (text) descEl.value = text.slice(0, 2000);
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.textContent = 'IA';
      }
    }
  }

  function bindAuto(cfg) {
    const titleEl = byId(cfg.titleId);
    const descEl = byId(cfg.descId);
    if (!titleEl || !descEl) return;
    titleEl.addEventListener('blur', async () => {
      if (isReadOnly()) return;
      if (String(descEl.value || '').trim()) return;
      const t = String(titleEl.value || '').trim();
      if (t.length < 4) return;
      const text = await generateDescription(t, cfg.kind);
      if (text && !String(descEl.value || '').trim()) {
        descEl.value = text.slice(0, 2000);
      }
    });
  }

  function init() {
    const configs = [
      { kind: 'project', titleId: 'projectName', descId: 'projectDesc', btnId: 'aiProjectDescBtn' },
      { kind: 'objective', titleId: 'objectiveTitle', descId: 'objectiveDesc', btnId: 'aiObjectiveDescBtn' },
      { kind: 'daily', titleId: 'dailyTitle', descId: 'dailyDescription', btnId: 'aiDailyDescBtn' }
    ];

    configs.forEach((cfg) => {
      const btn = byId(cfg.btnId);
      if (btn) btn.addEventListener('click', () => fill(cfg));
      bindAuto(cfg);
    });
  }

  return { init, generateDescription };
})();

if (typeof window !== 'undefined') {
  window.AIDescriptions = AIDescriptions;
}

