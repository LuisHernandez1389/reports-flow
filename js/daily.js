/* daily.js - Daily Work Entries */
'use strict';

const Daily = (() => {
  let _pendingFile = null;
  let _pendingFileBlob = null;
  let _filterDate = null;
  const isReadOnly = () => !!window.AppMode?.isReadOnly?.();

  function populateProjectSelect() {
    const sel = document.getElementById('dailyProject');
    const projects = DB.projects.getAll().filter(p => p.status === 'active');
    sel.innerHTML = '<option value="">- Soporte / imprevisto (sin proyecto) -</option>' +
      projects.map(p => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');
  }

  function renderEntries() {
    const all = DB.getActivityEntries();
    const filtered = _filterDate ? all.filter(e => e.date === _filterDate) : all;
    const container = document.getElementById('daily-entries-list');

    if (!filtered.length) {
      container.innerHTML = `<div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="width:40px;height:40px;margin:0 auto 10px;display:block;color:var(--text-muted)"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>
        <p>${_filterDate ? 'Sin entradas para esta fecha.' : 'Aun no hay entradas de trabajo.'}</p>
      </div>`;
      return;
    }

    const grouped = {};
    filtered.forEach(e => {
      if (!grouped[e.date]) grouped[e.date] = [];
      grouped[e.date].push(e);
    });

    container.innerHTML = Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map(date => {
      const entries = grouped[date];
      const totalHours = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
      return `
        <div class="entries-date-group" style="margin-bottom:14px">
          <div style="font-size:12px;color:var(--text-muted);font-weight:600;margin-bottom:8px;display:flex;justify-content:space-between">
            <span>${UI.fmtDate(date)}</span>
            <span>${totalHours > 0 ? totalHours + 'h' : ''}</span>
          </div>
          ${entries.map(e => renderEntry(e)).join('')}
        </div>`;
    }).join('');
  }

  function renderEntry(e) {
    const isProgress = e.entryType === 'progress';
    const proj = e.projectId ? DB.projects.getById(e.projectId) : null;
    const imgSrc = e.fileId ? DB.files.get(e.fileId) : null;
    const isPdf = isPdfRef(imgSrc);
    const objective = e.objectiveId ? DB.objectives.getById(e.objectiveId) : null;
    const catColors = {
      desarrollo: '#4F6EF7',
      diseno: '#8B5CF6',
      reunion: '#F59E0B',
      investigacion: '#06B6D4',
      otro: '#6B7280',
      avance: '#4F6EF7'
    };
    const categoryKey = isProgress ? 'avance' : normalizeCategory(e.category);
    const title = isProgress ? (e.description || 'Avance de proyecto') : e.title;
    return `<div class="entry-item">
      <div class="entry-top">
        <div>
          <div class="entry-title">${escHtml(title)}</div>
          <div class="entry-meta">
            ${e.hours ? `<span>${e.hours}h</span>` : ''}
            ${isProgress ? `<span>${e.percent || 0}% avance</span>` : ''}
            ${isProgress && objective ? `<span>Objetivo: ${escHtml(objective.title)}</span>` : ''}
            ${proj ? `<span style="color:${proj.color || 'var(--accent)'}">${escHtml(proj.name)}</span>` : '<span>Soporte</span>'}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <span class="entry-category" style="border-color:${catColors[categoryKey] || 'var(--border)'}33;color:${catColors[categoryKey] || 'var(--text-muted)'}">${isProgress ? 'avance' : (e.category || 'otro')}</span>
          ${isReadOnly() ? '' : `<button onclick="Daily.deleteEntry('${e.id}','${isProgress ? 'progress' : 'daily'}')" class="obj-action-btn danger" title="Eliminar entrada" aria-label="Eliminar entrada">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>`}
        </div>
      </div>
      ${!isProgress && e.description ? `<p class="entry-desc">${escHtml(e.description)}</p>` : ''}
      ${imgSrc && !isPdf ? `<img src="${imgSrc}" class="entry-img" onclick="UI.lightbox('${imgSrc}')" alt="Adjunto">` : ''}
      ${imgSrc && isPdf ? `<a href="${imgSrc}" target="_blank" rel="noopener" class="btn-ghost" style="margin-top:8px;display:inline-flex">Ver PDF</a>` : ''}
    </div>`;
  }

  async function submitEntry(e) {
    if (isReadOnly()) return;
    e.preventDefault();
    const title = document.getElementById('dailyTitle').value.trim();
    if (!title) { UI.toast('El titulo es requerido', 'error'); return; }
    let description = document.getElementById('dailyDescription').value.trim();
    if (!description && window.AIDescriptions?.generateDescription) {
      description = await AIDescriptions.generateDescription(title, 'daily');
      if (description) document.getElementById('dailyDescription').value = description;
    }

    const category = document.querySelector('input[name="dailyCategory"]:checked')?.value || 'otro';
    const data = {
      title,
      description,
      date: document.getElementById('dailyDate').value || new Date().toISOString().split('T')[0],
      hours: document.getElementById('dailyHours').value || null,
      projectId: document.getElementById('dailyProject').value || null,
      category
    };

    if (_pendingFile) {
      if (window.SupabaseStorage && SupabaseStorage.isConfigured() && _pendingFileBlob) {
        try {
          const up = await SupabaseStorage.uploadFile(_pendingFileBlob, 'daily');
          data.fileId = up.publicUrl || up.path;
        } catch {
          const fileId = DB.uid();
          DB.files.save(fileId, _pendingFile);
          data.fileId = fileId;
          UI.toast('No se pudo subir a Supabase. Se guardo localmente.', 'error');
        }
      } else {
        const fileId = DB.uid();
        DB.files.save(fileId, _pendingFile);
        data.fileId = fileId;
      }
    }

    DB.daily.add(data);
    UI.toast('Entrada guardada', 'success');
    document.getElementById('dailyForm').reset();
    document.getElementById('dailyFilePreview').innerHTML = '';
    document.getElementById('dailyDate').value = new Date().toISOString().split('T')[0];
    _pendingFile = null;
    _pendingFileBlob = null;
    renderEntries();
    App.refreshDashboard();
    document.dispatchEvent(new CustomEvent('daily:entry-saved'));
  }

  async function deleteEntry(id, type = 'daily') {
    if (isReadOnly()) return;
    const ok = await UI.confirm('Eliminar esta actividad?', { danger: true });
    if (!ok) return;
    if (type === 'progress') {
      const row = DB.progress.getAll().find(e => e.id === id);
      if (row?.fileId) DB.files.delete(row.fileId);
      DB.progress.delete(id);
      if (row?.objectiveId) {
        const objective = DB.objectives.getById(row.objectiveId);
        if (objective) {
          const objectiveLogs = DB.progress.getByObjective(row.objectiveId);
          const latestPercent = objectiveLogs.length ? (objectiveLogs[0].percent || 0) : 0;
          DB.objectives.update(row.objectiveId, { progress: latestPercent, done: latestPercent === 100 });
        }
      }
      UI.toast('Avance eliminado');
    } else {
      const row = DB.daily.getAll().find(e => e.id === id);
      if (row?.fileId) DB.files.delete(row.fileId);
      DB.daily.delete(id);
      UI.toast('Entrada eliminada');
    }
    renderEntries();
    App.refreshDashboard();
  }

  function refresh() {
    populateProjectSelect();
    renderEntries();
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('dailyDate').value = today;
    document.getElementById('todayDate').textContent = UI.fmtDate(today);
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function normalizeCategory(raw) {
    const n = String(raw || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    if (n.includes('desarrollo')) return 'desarrollo';
    if (n.includes('diseno')) return 'diseno';
    if (n.includes('reunion')) return 'reunion';
    if (n.includes('investigacion')) return 'investigacion';
    return 'otro';
  }

  function isPdfRef(src) {
    const s = String(src || '');
    if (!s) return false;
    return s.startsWith('data:application/pdf') || /\.pdf($|[?#])/i.test(s);
  }

  function init() {
    if (!isReadOnly()) {
      document.getElementById('dailyForm').addEventListener('submit', submitEntry);
    }

    if (!isReadOnly()) {
      UI.setupFileDrop(
        document.getElementById('dailyFileDrop'),
        document.getElementById('dailyFile'),
        document.getElementById('dailyFilePreview'),
        (b64, _name, _type, file) => { _pendingFile = b64; _pendingFileBlob = file || null; }
      );
    }

    document.getElementById('filterDate').addEventListener('change', e => {
      _filterDate = e.target.value || null;
      renderEntries();
    });

    document.getElementById('clearDateFilter').addEventListener('click', () => {
      _filterDate = null;
      document.getElementById('filterDate').value = '';
      renderEntries();
    });

    document.getElementById('dailyDate').value = new Date().toISOString().split('T')[0];
  }

  return { init, refresh, renderEntries, deleteEntry, populateProjectSelect };
})();
