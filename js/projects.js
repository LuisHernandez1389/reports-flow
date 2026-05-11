/* projects.js â€” Projects & Objectives */
'use strict';

const Projects = (() => {
  let selectedColor = '#4F6EF7';
  let coverBase64 = null;
  let coverFileBlob = null;
  let filterStatus = 'all';
  let searchQuery = '';
  const isReadOnly = () => !!window.AppMode?.isReadOnly?.();

  /* ---- RENDER PROJECTS GRID ---- */
  function renderGrid() {
    let projects = DB.projects.getAll();
    if (filterStatus !== 'all') projects = projects.filter(p => p.status === filterStatus);
    if (searchQuery) projects = projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));

    const grid = document.getElementById('projects-grid');
    if (!projects.length) {
      grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;padding:60px;">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="width:48px;height:48px;margin:0 auto 14px;display:block;color:var(--text-muted)"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>
        <p>No hay proyectos. <button class="btn-ghost" onclick="Projects.openNew()">Crea el primero</button></p>
      </div>`;
      return;
    }

    grid.innerHTML = projects.map(p => {
      const pct = DB.getProjectProgress(p.id);
      const objs = DB.objectives.getByProject(p.id);
      const activityCount = DB.daily.getByProject(p.id).length + DB.progress.getByProject(p.id).length;
      const coverSrc = p.coverId ? DB.files.get(p.coverId) : null;
      return `
        <div class="project-card" onclick="Projects.openDetail('${p.id}')">
          <div class="project-card-cover" style="--color:${p.color||'#4F6EF7'}">
            ${coverSrc ? `<img src="${coverSrc}" alt="${p.name}">` : ''}
            <div class="project-card-cover-gradient"></div>
          </div>
          ${isReadOnly() ? '' : `<div class="project-card-actions">
            <button class="card-action-btn" onclick="event.stopPropagation();Projects.openEdit('${p.id}')" title="Editar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="card-action-btn" onclick="event.stopPropagation();Projects.deleteProject('${p.id}')" title="Eliminar" style="color:#f87171">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
            </button>
          </div>`}
          <div class="project-card-body">
            <div class="project-card-top">
              <div class="project-card-name">${escHtml(p.name)}</div>
              <span class="status-badge ${p.status||'active'}">${statusLabel(p.status)}</span>
            </div>
            <p class="project-card-desc">${escHtml(p.description||'Sin descripciÃ³n')}</p>
            <div class="project-progress-bar">
              <div class="project-progress-fill" style="width:${pct}%;background:${p.color||'#4F6EF7'}"></div>
            </div>
            <div class="project-card-meta">
              <span>${objs.length} objetivo${objs.length!==1?'s':''} Â· ${pct}% avance</span>
              <span>${activityCount} act.</span>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  /* ---- OPEN PROJECT DETAIL ---- */
  function openDetail(id) {
    const project = DB.projects.getById(id);
    if (!project) return;
    const sameDetailView = window._currentView === 'project-detail' && window._activeProjectId === id;
    window._activeProjectId = id;
    if (!sameDetailView) UI.navigate('project-detail', id);
    renderDetail(project);
  }

  function renderDetail(project) {
    const objs = DB.objectives.getByProject(project.id);
    const pct = DB.getProjectProgress(project.id);
    const coverSrc = project.coverId ? DB.files.get(project.coverId) : null;

    const container = document.getElementById('project-detail-content');
    container.innerHTML = `
      <div class="project-detail-header">
        <div class="project-detail-banner" style="background:${project.color||'#4F6EF7'}20">
          ${coverSrc ? `<img src="${coverSrc}" alt="${project.name}">` : `<div style="position:absolute;inset:0;background:linear-gradient(135deg,${project.color||'#4F6EF7'}33,transparent)"></div>`}
          <div class="project-detail-banner-overlay"></div>
        </div>
        <div class="project-detail-info">
          <div>
            <h2 class="project-detail-title">${escHtml(project.name)}</h2>
            <p class="project-detail-desc">${escHtml(project.description||'')}</p>
          </div>
          ${isReadOnly() ? '' : `<div class="project-detail-actions">
            <button class="btn-secondary" onclick="Projects.openEdit('${project.id}')">Editar</button>
          </div>`}
        </div>
        <div class="project-meta-row">
          <span class="meta-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px"><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></svg>${UI.fmtDate(project.createdAt?.split('T')[0])}</span>
          ${project.startDate ? `<span class="meta-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="width:14px;height:14px"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>Inicio: ${UI.fmtDate(project.startDate)}</span>` : ''}
          ${project.endDate ? `<span class="meta-chip">LÃ­mite: ${UI.fmtDate(project.endDate)}</span>` : ''}
          <span class="status-badge ${project.status||'active'}">${statusLabel(project.status)}</span>
        </div>
        <div style="padding:0 24px 18px">
          <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-secondary);margin-bottom:6px">
            <span>Progreso general</span><span style="font-weight:600;color:var(--text-primary)">${pct}%</span>
          </div>
          <div class="project-progress-bar" style="height:8px">
            <div class="project-progress-fill" style="width:${pct}%;background:${project.color||'#4F6EF7'}"></div>
          </div>
        </div>
      </div>

      <div class="objectives-section">
        <div class="section-header">
          <span class="section-title">Objetivos (${objs.length})</span>
          ${isReadOnly() ? '' : `<button class="btn-primary" onclick="Projects.openNewObjective('${project.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:14px;height:14px"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nuevo objetivo
          </button>`}
        </div>
        <div class="objectives-list" id="objectives-list">
          ${objs.length ? objs.map(o => renderObjective(o, project.color)).join('') : '<p class="empty-state">No hay objetivos aÃºn.</p>'}
        </div>
      </div>
      `;
  }

    function renderObjective(o, color) {
    const progressEntries = DB.progress.getByObjective(o.id);
    return `<div class="objective-item" id="obj-${o.id}">
      <div class="objective-top">
        <div class="objective-title-row">
          <div class="objective-checkbox ${o.done?'done':''}" ${isReadOnly() ? '' : `onclick="Projects.toggleObjective('${o.id}')" title="Marcar como completado"`}></div>
          <span class="priority-dot ${o.priority||'medium'}"></span>
          <span class="objective-name ${o.done?'done':''}">${escHtml(o.title)}</span>
        </div>
        ${isReadOnly() ? '' : `<div class="objective-actions">
          <button class="obj-action-btn" onclick="Projects.openProgressModal('${o.projectId}','${o.id}')" title="Registrar avance" aria-label="Registrar avance">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button class="obj-action-btn" onclick="Projects.openEditObjective('${o.id}')" title="Editar objetivo" aria-label="Editar objetivo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="obj-action-btn danger" onclick="Projects.deleteObjective('${o.id}')" title="Eliminar objetivo" aria-label="Eliminar objetivo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>`}
      </div>
      ${o.description ? `<p style="font-size:13px;color:var(--text-secondary);margin:4px 0 8px 28px">${escHtml(o.description)}</p>` : ''}
      <div class="objective-progress">
        <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-bottom:5px">
          <span>${o.deadline ? 'LÃ­mite: ' + UI.fmtDate(o.deadline) : ''}</span>
          <span>${o.progress||0}% Â· ${progressEntries.length} avance${progressEntries.length!==1?'s':''}</span>
        </div>
        <div class="obj-progress-bar">
          <div class="obj-progress-fill" style="width:${o.progress||0}%;background:${color||'#4F6EF7'}"></div>
        </div>
      ${progressEntries.length ? `
        <div class="progress-entries" style="margin-top:12px">
          ${progressEntries.map(e => renderProgressEntry(e)).join('')}
        </div>
      ` : '<p class="empty-state" style="padding:12px 4px 0;text-align:left">Este objetivo aún no tiene avances.</p>'}
      </div>
    </div>`;
  }

  function renderProgressEntry(e) {
    const imgSrc = e.fileId ? DB.files.get(e.fileId) : null;
    const isPdf = isPdfRef(imgSrc);
    const obj = e.objectiveId ? DB.objectives.getById(e.objectiveId) : null;
    return `<div class="progress-entry">
      <div class="progress-entry-dot"></div>
      <div class="progress-entry-content">
        <p class="progress-entry-text">${escHtml(e.description)}</p>
        <div class="progress-entry-meta">
          ${UI.fmtDate(e.date)} ${obj ? `Â· Objetivo: ${escHtml(obj.title)}` : ''} Â· Avance: ${e.percent||0}%${e.hours ? ` Â· ${e.hours}h` : ''}
        </div>
      </div>
      ${imgSrc && !isPdf ? `<img src="${imgSrc}" class="progress-entry-img" onclick="UI.lightbox('${imgSrc}')" alt="Avance">` : ''}
      ${imgSrc && isPdf ? `<a href="${imgSrc}" target="_blank" rel="noopener" class="btn-ghost" style="align-self:flex-start">Ver PDF</a>` : ''}
      ${isReadOnly() ? '' : `<div class="item-actions">
        <button class="obj-action-btn danger" onclick="Projects.deleteProgress('${e.id}')" title="Eliminar avance" aria-label="Eliminar avance">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </div>`}
    </div>`;
  }

  /* ---- PROJECT MODAL ---- */
  function openNew() {
    if (isReadOnly()) return;
    selectedColor = '#4F6EF7';
    coverBase64 = null;
    document.getElementById('projectId').value = '';
    document.getElementById('projectName').value = '';
    document.getElementById('projectDesc').value = '';
    document.getElementById('projectStart').value = '';
    document.getElementById('projectEnd').value = '';
    document.getElementById('projectStatus').value = 'active';
    document.getElementById('projectCoverPreview').innerHTML = '';
    document.getElementById('projectCover').value = '';
    document.querySelectorAll('.color-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color === selectedColor);
    });
    document.getElementById('projectModalTitle').textContent = 'Nuevo Proyecto';
    UI.openModal('projectModal');
  }

  function openEdit(id) {
    if (isReadOnly()) return;
    const p = DB.projects.getById(id);
    if (!p) return;
    selectedColor = p.color || '#4F6EF7';
    coverBase64 = null;
    document.getElementById('projectId').value = id;
    document.getElementById('projectName').value = p.name;
    document.getElementById('projectDesc').value = p.description || '';
    document.getElementById('projectStart').value = p.startDate || '';
    document.getElementById('projectEnd').value = p.endDate || '';
    document.getElementById('projectStatus').value = p.status || 'active';
    document.querySelectorAll('.color-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.color === selectedColor);
    });
    if (p.coverId) {
      const src = DB.files.get(p.coverId);
      if (src) {
        const img = document.createElement('img');
        img.src = src;
        img.style.cssText = 'max-width:100%;max-height:150px;border-radius:8px;margin-top:8px;';
        document.getElementById('projectCoverPreview').innerHTML = '';
        document.getElementById('projectCoverPreview').appendChild(img);
      }
    } else {
      document.getElementById('projectCoverPreview').innerHTML = '';
    }
    document.getElementById('projectModalTitle').textContent = 'Editar Proyecto';
    UI.openModal('projectModal');
  }

  async function saveProject() {
    if (isReadOnly()) return;
    const name = document.getElementById('projectName').value.trim();
    if (!name) { UI.toast('El nombre del proyecto es requerido', 'error'); return; }
    const id = document.getElementById('projectId').value;
    let description = document.getElementById('projectDesc').value.trim();
    if (!description && window.AIDescriptions?.generateDescription) {
      description = await AIDescriptions.generateDescription(name, 'project');
      if (description) document.getElementById('projectDesc').value = description;
    }
    const data = {
      name,
      description,
      startDate: document.getElementById('projectStart').value,
      endDate: document.getElementById('projectEnd').value,
      status: document.getElementById('projectStatus').value,
      color: selectedColor
    };
    if (coverBase64) {
      if (window.SupabaseStorage && SupabaseStorage.isConfigured() && coverFileBlob) {
        try {
          const up = await SupabaseStorage.uploadFile(coverFileBlob, 'covers');
          data.coverId = up.publicUrl || up.path;
        } catch (_err) {
          const fileId = DB.uid();
          DB.files.save(fileId, coverBase64);
          data.coverId = fileId;
          UI.toast('No se pudo subir portada a Supabase. Se guardo local.', 'error');
        }
      } else {
        const fileId = DB.uid();
        DB.files.save(fileId, coverBase64);
        data.coverId = fileId;
      }
    }
    if (id) { DB.projects.update(id, data); UI.toast('Proyecto actualizado', 'success'); }
    else { DB.projects.add(data); UI.toast('Proyecto creado', 'success'); }
    UI.closeModal('projectModal');
    renderGrid();
    App.refreshDashboard();
    if (id && window._activeProjectId === id) {
      renderDetail(DB.projects.getById(id));
    }
  }

  async function deleteProject(id) {
    if (isReadOnly()) return;
    const ok = await UI.confirm('Eliminar este proyecto y todos sus datos?', { danger: true });
    if (!ok) return;
    DB.projects.delete(id);
    UI.toast('Proyecto eliminado');
    renderGrid();
    App.refreshDashboard();
    if (window._currentView === 'project-detail') UI.navigate('projects');
  }

  /* ---- OBJECTIVE MODAL ---- */
  function openNewObjective(projectId) {
    if (isReadOnly()) return;
    document.getElementById('objectiveId').value = '';
    document.getElementById('objectiveProjectId').value = projectId;
    document.getElementById('objectiveTitle').value = '';
    document.getElementById('objectiveDesc').value = '';
    document.getElementById('objectivePriority').value = 'medium';
    document.getElementById('objectiveDeadline').value = '';
    document.getElementById('objectiveModalTitle').textContent = 'Nuevo Objetivo';
    UI.openModal('objectiveModal');
  }

  function openEditObjective(id) {
    if (isReadOnly()) return;
    const o = DB.objectives.getById(id);
    if (!o) return;
    document.getElementById('objectiveId').value = id;
    document.getElementById('objectiveProjectId').value = o.projectId;
    document.getElementById('objectiveTitle').value = o.title;
    document.getElementById('objectiveDesc').value = o.description || '';
    document.getElementById('objectivePriority').value = o.priority || 'medium';
    document.getElementById('objectiveDeadline').value = o.deadline || '';
    document.getElementById('objectiveModalTitle').textContent = 'Editar Objetivo';
    UI.openModal('objectiveModal');
  }

  async function saveObjective() {
    if (isReadOnly()) return;
    const title = document.getElementById('objectiveTitle').value.trim();
    if (!title) { UI.toast('El tÃ­tulo es requerido', 'error'); return; }
    const id = document.getElementById('objectiveId').value;
    const projectId = document.getElementById('objectiveProjectId').value;
    let description = document.getElementById('objectiveDesc').value.trim();
    if (!description && window.AIDescriptions?.generateDescription) {
      description = await AIDescriptions.generateDescription(title, 'objective');
      if (description) document.getElementById('objectiveDesc').value = description;
    }
    const data = {
      projectId,
      title,
      description,
      priority: document.getElementById('objectivePriority').value,
      deadline: document.getElementById('objectiveDeadline').value
    };
    if (id) { DB.objectives.update(id, data); UI.toast('Objetivo actualizado', 'success'); }
    else { DB.objectives.add(data); UI.toast('Objetivo creado', 'success'); }
    UI.closeModal('objectiveModal');
    renderDetail(DB.projects.getById(projectId));
    App.refreshDashboard();
  }

  function toggleObjective(id) {
    if (isReadOnly()) return;
    const o = DB.objectives.getById(id);
    if (!o) return;
    DB.objectives.update(id, { done: !o.done, progress: !o.done ? 100 : o.progress });
    renderDetail(DB.projects.getById(o.projectId));
    App.refreshDashboard();
  }

  async function deleteObjective(id) {
    if (isReadOnly()) return;
    const o = DB.objectives.getById(id);
    if (!o) return;
    const ok = await UI.confirm('Eliminar este objetivo?', { danger: true });
    if (!ok) return;
    DB.objectives.delete(id);
    renderDetail(DB.projects.getById(o.projectId));
    App.refreshDashboard();
  }
  async function deleteProgress(id) {
    if (isReadOnly()) return;
    const entry = DB.progress.getAll().find(p => p.id === id);
    if (!entry) return;
    const ok = await UI.confirm('Eliminar este avance?', { danger: true });
    if (!ok) return;
    if (entry.fileId) DB.files.delete(entry.fileId);
    DB.progress.delete(id);
    if (entry.objectiveId) {
      const objective = DB.objectives.getById(entry.objectiveId);
      if (objective) {
        const objectiveLogs = DB.progress.getByObjective(entry.objectiveId);
        const latestPercent = objectiveLogs.length ? (objectiveLogs[0].percent || 0) : 0;
        DB.objectives.update(entry.objectiveId, { progress: latestPercent, done: latestPercent === 100 });
      }
    }
    UI.toast('Avance eliminado');
    const activeProjectId = window._activeProjectId || entry.projectId;
    const activeProject = DB.projects.getById(activeProjectId);
    if (activeProject) renderDetail(activeProject);
    App.refreshDashboard();
  }

  /* ---- PROGRESS MODAL ---- */
  let _progressFile = null;
  let _progressFileBlob = null;

  function openProgressModal(projectId, objectiveId) {
    if (isReadOnly()) return;
    _progressFile = null;
    _progressFileBlob = null;
    document.getElementById('progressProjectId').value = projectId;
    document.getElementById('progressObjectiveId').value = objectiveId || '';
    document.getElementById('progressDesc').value = '';
    document.getElementById('progressPercent').value = 50;
    document.getElementById('progressPercentLabel').textContent = '50%';
    document.getElementById('progressHours').value = '';
    document.getElementById('progressFilePreview').innerHTML = '';
    document.getElementById('progressFile').value = '';
    UI.openModal('progressModal');
  }

  async function saveProgress() {
    if (isReadOnly()) return;
    const desc = document.getElementById('progressDesc').value.trim();
    if (!desc) { UI.toast('La descripciÃ³n es requerida', 'error'); return; }
    const hoursRaw = document.getElementById('progressHours').value;
    const hoursNum = Number(hoursRaw);
    if (!Number.isFinite(hoursNum) || hoursNum <= 0) {
      UI.toast('Las horas son requeridas en el avance', 'error');
      return;
    }
    const projectId = document.getElementById('progressProjectId').value;
    const objectiveId = document.getElementById('progressObjectiveId').value;
    const percent = parseInt(document.getElementById('progressPercent').value);
    const data = {
      projectId, objectiveId: objectiveId || null,
      description: desc,
      percent,
      hours: String(Math.max(0.5, Math.min(24, hoursNum))),
      date: new Date().toISOString().split('T')[0]
    };
    if (_progressFile) {
      if (window.SupabaseStorage && SupabaseStorage.isConfigured() && _progressFileBlob) {
        try {
          const up = await SupabaseStorage.uploadFile(_progressFileBlob, 'progress');
          data.fileId = up.publicUrl || up.path;
        } catch (_err) {
          const fileId = DB.uid();
          DB.files.save(fileId, _progressFile);
          data.fileId = fileId;
          UI.toast('No se pudo subir evidencia a Supabase. Se guardo local.', 'error');
        }
      } else {
        const fileId = DB.uid();
        DB.files.save(fileId, _progressFile);
        data.fileId = fileId;
      }
    }
    DB.progress.add(data);
    if (objectiveId) DB.objectives.update(objectiveId, { progress: percent });
    UI.toast('Avance registrado', 'success');
    UI.closeModal('progressModal');
    renderDetail(DB.projects.getById(projectId));
    App.refreshDashboard();
  }

  /* ---- HELPERS ---- */
  function statusLabel(s) {
    return { active:'Activo', paused:'Pausado', completed:'Completado' }[s] || 'Activo';
  }

  function escHtml(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function isPdfRef(src) {
    const s = String(src || '');
    if (!s) return false;
    return s.startsWith('data:application/pdf') || /\.pdf($|[?#])/i.test(s);
  }

  /* ---- INIT ---- */
  function init() {
    // Color picker
    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedColor = btn.dataset.color;
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    // Cover file
    UI.setupFileDrop(
      document.getElementById('projectFileDrop'),
      document.getElementById('projectCover'),
      document.getElementById('projectCoverPreview'),
      (b64, _name, _type, file) => { coverBase64 = b64; coverFileBlob = file || null; }
    );

    // Progress file
    UI.setupFileDrop(
      document.getElementById('progressFileDrop'),
      document.getElementById('progressFile'),
      document.getElementById('progressFilePreview'),
      (b64, _name, _type, file) => { _progressFile = b64; _progressFileBlob = file || null; }
    );

    // Progress range
    document.getElementById('progressPercent').addEventListener('input', function() {
      document.getElementById('progressPercentLabel').textContent = this.value + '%';
    });

    // Save buttons
    document.getElementById('saveProject').addEventListener('click', saveProject);
    document.getElementById('saveObjective').addEventListener('click', saveObjective);
    document.getElementById('saveProgress').addEventListener('click', saveProgress);

    // Filters
    document.querySelectorAll('.filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        filterStatus = tab.dataset.filter;
        renderGrid();
      });
    });

    document.getElementById('projectSearch').addEventListener('input', e => {
      searchQuery = e.target.value;
      renderGrid();
    });

    document.getElementById('backToProjects').addEventListener('click', () => {
      UI.navigate('projects');
      renderGrid();
    });
  }

  return { init, renderGrid, openNew, openEdit, openDetail, deleteProject, openNewObjective, openEditObjective, toggleObjective, deleteObjective, openProgressModal, deleteProgress };
})();







