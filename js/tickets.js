/* tickets.js - External Supabase tickets integration */
'use strict';

const Tickets = (() => {
  const CFG_KEY = 'pf_tickets_cfg';
  const DEFAULT_CFG = {
    url: 'https://kpefwyirteartbfxrusb.supabase.co',
    key: ''
  };

  let cache = [];
  let filterStatus = 'all';
  let search = '';

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

  function fillSettingsForm() {
    const cfg = getCfg();
    const urlEl = document.getElementById('tkUrl');
    const keyEl = document.getElementById('tkKey');
    if (urlEl) urlEl.value = cfg.url || '';
    if (keyEl) keyEl.value = cfg.key || '';
  }

  function getClient() {
    if (!window.supabase?.createClient) return null;
    const cfg = getCfg();
    if (!cfg.url || !cfg.key) return null;
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
    if (metaEl) metaEl.textContent = `${attendedCount} atendido(s) de ${cache.length} ticket(s)`;

    if (!rows.length) {
      listEl.innerHTML = `<div class="empty-state"><p>No hay tickets para los filtros actuales.</p></div>`;
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
    const client = getClient();
    if (!client) {
      setStatus('Falta configurar URL y Publishable Key de Tickets.', true);
      cache = [];
      render();
      return [];
    }

    const { data, error } = await client
      .from('tickets')
      .select('id, code, title, description, status, priority, category, client_name, department, agent_name, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(300);

    if (error) {
      setStatus(`Error tickets: ${error.message}`, true);
      throw error;
    }

    cache = Array.isArray(data) ? data : [];
    setStatus(`Tickets cargados: ${cache.length}`);
    render();
    return cache;
  }

  async function verifyConnection() {
    const client = getClient();
    if (!client) {
      setStatus('Configura URL y key para verificar.', true);
      return;
    }
    const { count, error } = await client.from('tickets').select('*', { count: 'exact', head: true });
    if (error) {
      setStatus(`Sin acceso: ${error.message}`, true);
      return;
    }
    setStatus(`Conexion OK · tickets: ${count || 0}`);
  }

  function saveFromInputs() {
    const url = document.getElementById('tkUrl')?.value?.trim() || DEFAULT_CFG.url;
    const key = document.getElementById('tkKey')?.value?.trim() || '';
    setCfg({ url, key });
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
        fetchTickets().catch(() => {});
      });
    }

    const saveBtn = document.getElementById('saveTicketsCfgBtn');
    if (saveBtn) saveBtn.addEventListener('click', saveFromInputs);

    const syncBtn = document.getElementById('syncTicketsBtn');
    if (syncBtn) {
      syncBtn.addEventListener('click', () => {
        fetchTickets().catch(() => {});
      });
    }

    const verifyBtn = document.getElementById('verifyTicketsBtn');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', () => {
        verifyConnection().catch(() => {});
      });
    }
  }

  function refresh() {
    render();
    if (!cache.length) {
      fetchTickets().catch(() => {});
    }
  }

  function init() {
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
    getCfg
  };
})();

if (typeof window !== 'undefined') {
  window.Tickets = Tickets;
}
