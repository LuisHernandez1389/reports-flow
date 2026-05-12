/* tickets.js - External Supabase tickets integration */
'use strict';

const Tickets = (() => {
  const CFG_KEY = 'pf_tickets_cfg';
  const LOG_PREFIX = '[ProjectFlow/Tickets]';
  const DEFAULT_CFG = {
    url: 'https://kpefwyirteartbfxrusb.supabase.co',
    key: ''
  };

  let cache = [];
  let filterStatus = 'all';
  let search = '';
  let lastError = '';
  let lastStep = 'init';
  const debugLog = [];

  function isReadOnly() {
    return !!window.AppMode?.isReadOnly?.();
  }

  function parseJson(raw, fallback) {
    try { return JSON.parse(raw || ''); } catch { return fallback; }
  }

  function getCfg() {
    const saved = parseJson(localStorage.getItem(CFG_KEY), null);
    if (!saved) return { ...DEFAULT_CFG };
    return {
      url: String(saved?.url || DEFAULT_CFG.url).trim(),
      key: String(saved?.key || '').trim()
    };
  }

  function setCfg(cfg) {
    const safe = {
      url: String(cfg?.url || DEFAULT_CFG.url).trim(),
      key: String(cfg?.key || '').trim()
    };
    localStorage.setItem(CFG_KEY, JSON.stringify(safe));
  }

  function setStatus(msg, isError = false) {
    const el = document.getElementById('tkStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--text-muted)';
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function shortKey(key) {
    const raw = String(key || '').trim();
    if (!raw) return '(vacia)';
    if (raw.length <= 12) return raw;
    return `${raw.slice(0, 8)}...${raw.slice(-4)}`;
  }

  function pushLog(level, msg, meta) {
    const entry = {
      at: nowIso(),
      level: String(level || 'info'),
      msg: String(msg || ''),
      meta: meta || null
    };
    debugLog.push(entry);
    if (debugLog.length > 80) debugLog.shift();

    if (level === 'error') console.error(LOG_PREFIX, msg, meta || '');
    else if (level === 'warn') console.warn(LOG_PREFIX, msg, meta || '');
    else console.log(LOG_PREFIX, msg, meta || '');
  }

  function serializeError(err) {
    if (!err) return 'Error desconocido';
    const parts = [];
    if (err.message) parts.push(`message: ${err.message}`);
    if (err.code) parts.push(`code: ${err.code}`);
    if (err.hint) parts.push(`hint: ${err.hint}`);
    if (err.details) parts.push(`details: ${err.details}`);
    return parts.length ? parts.join(' | ') : String(err);
  }

  function fillSettingsForm() {
    const cfg = getCfg();
    const urlEl = document.getElementById('tkUrl');
    const keyEl = document.getElementById('tkKey');
    if (urlEl) urlEl.value = cfg.url || '';
    if (keyEl) keyEl.value = cfg.key || '';
  }

  function getClient() {
    lastStep = 'getClient';
    if (!window.supabase?.createClient) return null;
    const cfg = getCfg();
    if (!cfg.url || !cfg.key) return null;
    pushLog('info', 'Creando cliente Supabase para Tickets', {
      step: lastStep,
      url: cfg.url,
      keyPreview: shortKey(cfg.key)
    });
    return window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: false }
    });
  }

  function isAttendedStatus(status) {
    const s = String(status || '').toLowerCase();
    return s.includes('cerrad') || s.includes('resuelt') || s.includes('atendid') || s.includes('done');
  }

  function isOpenStatus(status) {
    return !isAttendedStatus(status);
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function fmtDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function statusColor(status) {
    const s = String(status || '').toLowerCase();
    if (s.includes('cerrad') || s.includes('resuelt')) return 'var(--green)';
    if (s.includes('progreso') || s.includes('proceso') || s.includes('working')) return 'var(--amber)';
    if (s.includes('abiert') || s.includes('nuevo') || s.includes('pendiente')) return 'var(--accent)';
    return 'var(--text-muted)';
  }

  function filteredTickets() {
    let rows = [...cache];

    if (filterStatus === 'atendidos') rows = rows.filter((r) => isAttendedStatus(r.status));
    else if (filterStatus === 'abiertos') rows = rows.filter((r) => isOpenStatus(r.status));

    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        String(r.code || '').toLowerCase().includes(q) ||
        String(r.title || '').toLowerCase().includes(q) ||
        String(r.client_name || '').toLowerCase().includes(q)
      );
    }

    return rows;
  }

  function render() {
    const listEl = document.getElementById('ticketsList');
    const metaEl = document.getElementById('ticketsMetaInfo');
    if (!listEl) return;

    const rows = filteredTickets();
    const attendedCount = cache.filter((r) => isAttendedStatus(r.status)).length;
    if (metaEl) {
      const base = `${attendedCount} atendido(s) de ${cache.length} ticket(s)`;
      metaEl.textContent = lastError ? `${base} · Error detectado` : base;
      metaEl.style.color = lastError ? 'var(--red)' : '';
    }

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty-state">
        <p>${lastError ? 'No se pudieron cargar los tickets.' : 'No hay tickets para los filtros actuales.'}</p>
        ${lastError ? `<p style="margin-top:8px;color:var(--red);font-size:12px;line-height:1.5">Paso: ${escHtml(lastStep)}<br>${escHtml(lastError)}</p>` : ''}
      </div>`;
      return;
    }

    listEl.innerHTML = rows.map((t) => {
      const status = escHtml(t.status || 'Sin estado');
      const priority = escHtml(t.priority || 'Sin prioridad');
      const category = escHtml(t.category || 'Sin categoria');
      const agent = escHtml(t.agent_name || 'Sin asignar');
      const updated = fmtDate(t.updated_at || t.created_at);
      return `
        <div class="entry-item">
          <div class="entry-top">
            <div>
              <div class="entry-title">${escHtml(t.code || 'TICKET')} · ${escHtml(t.title || '')}</div>
              <div class="entry-meta">
                <span>${escHtml(t.client_name || 'Cliente')}</span>
                <span>${category}</span>
                <span style="color:${statusColor(t.status)}">${status}</span>
                <span>Prioridad: ${priority}</span>
              </div>
            </div>
            <span class="entry-category">${priority}</span>
          </div>
          <p class="entry-desc">${escHtml(t.description || '')}</p>
          <div class="entry-meta">
            <span>Agente: ${agent}</span>
            <span>Depto: ${escHtml(t.department || '-')}</span>
            <span>Actualizado: ${updated}</span>
          </div>
        </div>
      `;
    }).join('');
  }

  async function fetchTickets() {
    lastStep = 'fetchTickets';
    lastError = '';
    pushLog('info', 'Inicio de carga de tickets', { step: lastStep });

    const client = getClient();
    if (!client) {
      lastError = 'Falta configurar URL y Publishable Key de Tickets.';
      pushLog('error', 'Configuracion incompleta para Tickets', {
        step: lastStep,
        cfg: { url: getCfg().url, keyPreview: shortKey(getCfg().key) }
      });
      setStatus(lastError, true);
      cache = [];
      render();
      return [];
    }

    lastStep = 'query:tickets.select';
    pushLog('info', 'Ejecutando query a tabla tickets', {
      step: lastStep,
      orderBy: 'updated_at desc',
      limit: 300
    });

    const { data, error } = await client
      .from('tickets')
      .select('id, code, title, description, status, priority, category, client_name, department, agent_name, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(300);

    if (error) {
      lastError = serializeError(error);
      pushLog('error', 'Error en query de tickets', {
        step: lastStep,
        error: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details
        }
      });
      setStatus(`Error tickets: ${lastError}`, true);
      cache = [];
      render();
      throw error;
    }

    cache = Array.isArray(data) ? data : [];
    pushLog('info', 'Tickets cargados correctamente', {
      step: lastStep,
      rows: cache.length
    });
    setStatus(`Tickets cargados: ${cache.length}`);
    render();
    return cache;
  }

  async function verifyConnection() {
    lastStep = 'verifyConnection';
    lastError = '';
    pushLog('info', 'Inicio de verificacion de conexion tickets', { step: lastStep });

    const client = getClient();
    if (!client) {
      lastError = 'Configura URL y key para verificar.';
      pushLog('error', 'No se puede verificar por configuracion faltante', {
        step: lastStep,
        cfg: { url: getCfg().url, keyPreview: shortKey(getCfg().key) }
      });
      setStatus(lastError, true);
      return;
    }

    lastStep = 'query:tickets.head_count';
    const { count, error } = await client.from('tickets').select('*', { count: 'exact', head: true });
    if (error) {
      lastError = serializeError(error);
      pushLog('error', 'Fallo verificacion de tickets', {
        step: lastStep,
        error: {
          message: error.message,
          code: error.code,
          hint: error.hint,
          details: error.details
        }
      });
      setStatus(`Sin acceso: ${lastError}`, true);
      return;
    }
    pushLog('info', 'Verificacion OK', { step: lastStep, count: count || 0 });
    setStatus(`Conexion OK · tickets: ${count || 0}`);
  }

  function saveFromInputs() {
    lastStep = 'saveFromInputs';
    const url = document.getElementById('tkUrl')?.value?.trim() || DEFAULT_CFG.url;
    const key = document.getElementById('tkKey')?.value?.trim() || '';
    setCfg({ url, key });
    pushLog('info', 'Configuracion de Tickets guardada', {
      step: lastStep,
      url,
      keyPreview: shortKey(key)
    });
    setStatus('Configuracion de Tickets guardada.');
  }

  function bindEvents() {
    document.querySelectorAll('[data-ticket-status]').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-ticket-status]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        filterStatus = btn.dataset.ticketStatus || 'all';
        render();
      });
    });

    const searchEl = document.getElementById('ticketSearch');
    if (searchEl) {
      searchEl.addEventListener('input', (e) => {
        search = String(e.target.value || '').trim();
        render();
      });
    }

    const refreshBtn = document.getElementById('ticketsRefreshBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        fetchTickets().catch((err) => {
          pushLog('error', 'Fallo al actualizar tickets desde boton', {
            step: lastStep,
            error: serializeError(err)
          });
        });
      });
    }

    const saveBtn = document.getElementById('saveTicketsCfgBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveFromInputs);

    const syncBtn = document.getElementById('syncTicketsBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        fetchTickets().catch((err) => {
          pushLog('error', 'Fallo al cargar tickets desde configuracion', {
            step: lastStep,
            error: serializeError(err)
          });
        });
      });
    }

    const verifyBtn = document.getElementById('verifyTicketsBtn');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', () => {
        verifyConnection().catch((err) => {
          pushLog('error', 'Fallo al verificar conexion de tickets', {
            step: lastStep,
            error: serializeError(err)
          });
        });
      });
    }
  }

  function refresh() {
    lastStep = 'refresh';
    pushLog('info', 'Refrescando vista Tickets', {
      step: lastStep,
      cachedRows: cache.length
    });
    render();
    if (!cache.length) {
      fetchTickets().catch((err) => {
        pushLog('error', 'Fallo auto-carga en refresh', {
          step: lastStep,
          error: serializeError(err)
        });
      });
    }
  }

  function init() {
    lastStep = 'init';
    pushLog('info', 'Inicializando modulo Tickets', { step: lastStep });
    fillSettingsForm();
    bindEvents();
    if (isReadOnly()) {
      const saveBtn = document.getElementById('saveTicketsCfgBtn');
      if (saveBtn) saveBtn.style.display = 'none';
    }
  }

  return {
    init,
    refresh,
    fetchTickets,
    verifyConnection,
    fillSettingsForm,
    getCfg,
    getDebugLog: () => [...debugLog],
    getLastError: () => lastError
  };
})();

if (typeof window !== 'undefined') {
  window.Tickets = Tickets;
}
