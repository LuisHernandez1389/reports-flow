/* supabase-data.js - cloud persistence mirror for ProjectFlow */
'use strict';

const SupabaseData = (() => {
  const TABLES = {
    pf_projects: 'projects',
    pf_objectives: 'objectives',
    pf_progress: 'progress_entries',
    pf_daily: 'daily_entries'
  };

  let syncTimer = null;
  let hydrating = false;
  let sdkLoading = null;

  function safeParseArray(raw) {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function toMillis(v) {
    const t = new Date(String(v || '')).getTime();
    return Number.isFinite(t) ? t : 0;
  }

  function rowStamp(row) {
    return Math.max(
      toMillis(row?.updatedAt),
      toMillis(row?.updated_at),
      toMillis(row?.createdAt),
      toMillis(row?.created_at),
      toMillis(row?.date)
    );
  }

  function mergeLocalAndRemote(localRows, remoteRows) {
    const map = new Map();
    for (const row of localRows || []) {
      if (!row || !row.id) continue;
      map.set(row.id, row);
    }
    for (const row of remoteRows || []) {
      if (!row || !row.id) continue;
      if (!map.has(row.id)) {
        map.set(row.id, row);
        continue;
      }
      const current = map.get(row.id);
      const pickRemote = rowStamp(row) >= rowStamp(current);
      map.set(row.id, pickRemote ? row : current);
    }
    return Array.from(map.values());
  }

  async function ensureSdkLoaded() {
    if (window.supabase?.createClient) return true;
    if (sdkLoading) return sdkLoading;
    sdkLoading = new Promise((resolve) => {
      const el = document.createElement('script');
      el.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      el.async = true;
      el.onload = () => resolve(!!window.supabase?.createClient);
      el.onerror = () => resolve(false);
      document.head.appendChild(el);
    });
    return sdkLoading;
  }

  function cfg() {
    return window.SupabaseStorage?.getConfig?.() || null;
  }

  async function client() {
    await ensureSdkLoaded();
    if (window.SupabaseStorage?.getClient) {
      const shared = SupabaseStorage.getClient();
      if (shared) return shared;
    }
    const c = cfg();
    if (!window.supabase || !c?.url || !c?.key) return null;
    return window.supabase.createClient(c.url, c.key, { auth: { persistSession: false } });
  }

  function fromLocalRow(key, r) {
    if (key === 'pf_projects') return {
      id: r.id, created_at: r.createdAt, updated_at: r.updatedAt || null, name: r.name,
      description: r.description || null, status: r.status || 'active', color: r.color || null,
      start_date: r.startDate || null, end_date: r.endDate || null, cover_file: r.coverId || null
    };
    if (key === 'pf_objectives') return {
      id: r.id, created_at: r.createdAt, project_id: r.projectId, title: r.title,
      description: r.description || null, priority: r.priority || null, deadline: r.deadline || null,
      progress: Number(r.progress || 0), done: !!r.done
    };
    if (key === 'pf_progress') return {
      id: r.id, created_at: r.createdAt, project_id: r.projectId, objective_id: r.objectiveId || null,
      description: r.description, percent: Number(r.percent || 0), date: r.date,
      hours: r.hours == null ? null : Number(r.hours), file_ref: r.fileId || null
    };
    if (key === 'pf_daily') return {
      id: r.id, created_at: r.createdAt, project_id: r.projectId || null, title: r.title,
      description: r.description || null, date: r.date, hours: r.hours == null ? null : Number(r.hours),
      category: r.category || null, file_ref: r.fileId || null
    };
    return r;
  }

  function toLocalRows(key, rows) {
    if (key === 'pf_projects') return rows.map(r => ({
      id: r.id, createdAt: r.created_at, updatedAt: r.updated_at || undefined,
      name: r.name, description: r.description || '', status: r.status || 'active', color: r.color || undefined,
      startDate: r.start_date || '', endDate: r.end_date || '', coverId: r.cover_file || null
    }));
    if (key === 'pf_objectives') return rows.map(r => ({
      id: r.id, createdAt: r.created_at, projectId: r.project_id, title: r.title,
      description: r.description || '', priority: r.priority || 'medium', deadline: r.deadline || '',
      progress: Number(r.progress || 0), done: !!r.done
    }));
    if (key === 'pf_progress') return rows.map(r => ({
      id: r.id, createdAt: r.created_at, projectId: r.project_id, objectiveId: r.objective_id || null,
      description: r.description, percent: Number(r.percent || 0), date: r.date,
      hours: r.hours == null ? null : String(r.hours), fileId: r.file_ref || null
    }));
    if (key === 'pf_daily') return rows.map(r => ({
      id: r.id, createdAt: r.created_at, projectId: r.project_id || null, title: r.title,
      description: r.description || '', date: r.date, hours: r.hours == null ? null : String(r.hours),
      category: r.category || 'otro', fileId: r.file_ref || null
    }));
    return rows;
  }

  async function hydrateLocal() {
    const c = await client();
    if (!c) return false;
    hydrating = true;
    try {
      const keys = Object.keys(TABLES);
      const fetched = {};
      let remoteCount = 0;
      for (const key of keys) {
        const table = TABLES[key];
        const { data, error } = await c.from(table).select('*');
        if (error) throw error;
        fetched[key] = data || [];
        remoteCount += fetched[key].length;
      }

      // If cloud is empty but local has data, push local up instead of wiping.
      const localHasData = keys.some(k => {
        try { return JSON.parse(localStorage.getItem(k) || '[]').length > 0; }
        catch { return false; }
      });
      if (remoteCount === 0 && localHasData) {
        await syncAll();
        return true;
      }

      for (const key of keys) {
        const remoteMapped = toLocalRows(key, fetched[key]);
        const localRows = safeParseArray(localStorage.getItem(key));
        const merged = mergeLocalAndRemote(localRows, remoteMapped);
        localStorage.setItem(key, JSON.stringify(merged));
      }
      return true;
    } finally {
      hydrating = false;
    }
  }

  async function syncKey(key) {
    const c = await client();
    if (!c || hydrating) return;
    const table = TABLES[key];
    if (!table) return;
    const rows = safeParseArray(localStorage.getItem(key));
    const mapped = rows.map(r => fromLocalRow(key, r));
    if (!mapped.length) return;
    const up = await c.from(table).upsert(mapped, { onConflict: 'id' });
    if (up.error) throw up.error;
  }

  async function syncAll() {
    const keys = Object.keys(TABLES);
    for (const k of keys) await syncKey(k);
  }

  async function getCounts() {
    const c = await client();
    if (!c) {
      const cfg = window.SupabaseStorage?.getConfig?.();
      const hasCfg = !!(cfg?.url && cfg?.key);
      const hasSdk = !!window.supabase?.createClient;
      throw new Error(`Supabase no configurado (cfg:${hasCfg ? 'ok' : 'faltante'}, sdk:${hasSdk ? 'ok' : 'faltante'})`);
    }
    const out = {};
    for (const [key, table] of Object.entries(TABLES)) {
      const { count, error } = await c.from(table).select('*', { count: 'exact', head: true });
      if (error) throw error;
      out[key] = count || 0;
    }
    return out;
  }

  async function syncNow() {
    await syncAll();
    return getCounts();
  }

  function scheduleSync() {
    if (hydrating) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => {
      syncAll().catch(() => {});
    }, 700);
  }

  return { hydrateLocal, scheduleSync, syncNow, getCounts };
})();

if (typeof window !== 'undefined') {
  window.SupabaseData = SupabaseData;
}
