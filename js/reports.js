/* reports.js - Report Generation */
'use strict';

const Reports = (() => {
  let currentWeekOffset = 0;
  let activeReport = 'daily';

  function init() {
    document.querySelectorAll('.report-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.report-tab').forEach((t) => t.classList.remove('active'));
        document.querySelectorAll('.report-panel').forEach((p) => p.classList.remove('active'));
        tab.classList.add('active');
        activeReport = tab.dataset.report;
        document.getElementById(`report-${activeReport}-panel`).classList.add('active');
        refreshCurrentReport();
      });
    });

    const today = new Date().toISOString().split('T')[0];
    document.getElementById('reportDailyDate').value = today;
    document.getElementById('reportDailyDate').addEventListener('change', renderDailyReport);

    document.getElementById('prevWeek').addEventListener('click', () => {
      currentWeekOffset -= 1;
      renderWeeklyReport();
    });
    document.getElementById('nextWeek').addEventListener('click', () => {
      currentWeekOffset += 1;
      renderWeeklyReport();
    });

    document.getElementById('reportProjectSelect').addEventListener('change', renderProjectReport);
    document.getElementById('printReport').addEventListener('click', () => window.print());
  }

  function refresh() {
    const sel = document.getElementById('reportProjectSelect');
    const projects = DB.projects.getAll();
    sel.innerHTML = '<option value="">Selecciona un proyecto</option>' +
      projects.map((p) => `<option value="${p.id}">${escHtml(p.name)}</option>`).join('');

    refreshCurrentReport();
  }

  function refreshCurrentReport() {
    if (activeReport === 'daily') renderDailyReport();
    else if (activeReport === 'weekly') renderWeeklyReport();
    else if (activeReport === 'project') renderProjectReport();
  }

  function renderDailyReport() {
    const date = document.getElementById('reportDailyDate').value;
    const entries = DB.getActivityEntries().filter((e) => e.date === date);
    const container = document.getElementById('report-daily-content');

    const totalHours = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
    const projects = [...new Set(entries.filter((e) => e.projectId).map((e) => e.projectId))];
    const byCategory = {};
    entries.forEach((e) => {
      byCategory[e.category || 'otro'] = (byCategory[e.category || 'otro'] || 0) + 1;
    });

    if (!entries.length) {
      container.innerHTML = `<div class="report-empty">Sin registros para ${UI.fmtDate(date)}</div>`;
      return;
    }

    container.innerHTML = `
      <div class="report-summary">
        <div class="report-stat"><span class="report-stat-num">${entries.length}</span><span class="report-stat-label">Actividades registradas</span></div>
        <div class="report-stat"><span class="report-stat-num">${totalHours}h</span><span class="report-stat-label">Horas totales</span></div>
        <div class="report-stat"><span class="report-stat-num">${projects.length}</span><span class="report-stat-label">Proyectos tocados</span></div>
        <div class="report-stat"><span class="report-stat-num">${Object.keys(byCategory).length}</span><span class="report-stat-label">Categorias</span></div>
      </div>
      ${Object.keys(byCategory).length > 1 ? renderCategoryBreakdown(byCategory) : ''}
      <p class="report-section-title">Detalle de Actividades</p>
      <div class="report-entries">
        ${entries.map((e) => renderReportEntry(e)).join('')}
      </div>
    `;
  }

  function renderWeeklyReport() {
    const week = DB.getWeekDates(currentWeekOffset);
    const entries = DB.getActivityByWeek(week.start, week.end);
    const container = document.getElementById('report-weekly-content');

    document.getElementById('weekLabel').textContent = `${UI.fmtDateShort(week.start)} - ${UI.fmtDate(week.end)}`;

    const totalHours = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
    const projects = [...new Set(entries.filter((e) => e.projectId).map((e) => e.projectId))];
    const byCategory = {};
    entries.forEach((e) => {
      byCategory[e.category || 'otro'] = (byCategory[e.category || 'otro'] || 0) + 1;
    });

    const perDay = week.days.map((day) => ({
      day,
      entries: entries.filter((e) => e.date === day),
      hours: entries.filter((e) => e.date === day).reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
    }));

    const dayNames = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom'];

    container.innerHTML = `
      <div class="report-summary">
        <div class="report-stat"><span class="report-stat-num">${entries.length}</span><span class="report-stat-label">Actividades totales</span></div>
        <div class="report-stat"><span class="report-stat-num">${totalHours}h</span><span class="report-stat-label">Horas totales</span></div>
        <div class="report-stat"><span class="report-stat-num">${projects.length}</span><span class="report-stat-label">Proyectos</span></div>
        <div class="report-stat"><span class="report-stat-num">${perDay.filter((d) => d.entries.length).length}</span><span class="report-stat-label">Dias trabajados</span></div>
      </div>

      <p class="report-section-title">Actividad por Dia</p>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:20px">
        ${perDay.map((d, i) => `
          <div style="background:${d.entries.length ? 'var(--accent-dim)' : 'var(--bg-surface)'};border:1px solid ${d.entries.length ? 'rgba(79,110,247,0.25)' : 'var(--border)'};border-radius:10px;padding:12px 8px;text-align:center">
            <div style="font-size:11px;color:var(--text-muted);margin-bottom:4px">${dayNames[i]}</div>
            <div style="font-size:18px;font-weight:700;color:${d.entries.length ? 'var(--accent)' : 'var(--text-muted)'}">${d.entries.length}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${d.hours > 0 ? `${d.hours}h` : '-'}</div>
          </div>`).join('')}
      </div>

      ${Object.keys(byCategory).length ? renderCategoryBreakdown(byCategory) : ''}

      ${projects.length ? `
        <p class="report-section-title">Proyectos Trabajados</p>
        ${projects.map((pid) => {
          const p = DB.projects.getById(pid);
          if (!p) return '';
          const pEntries = entries.filter((e) => e.projectId === pid);
          const pHours = pEntries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
          return `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="width:10px;height:10px;border-radius:50%;background:${p.color || 'var(--accent)'}"></div>
            <span style="flex:1;font-size:14px;color:var(--text-primary)">${escHtml(p.name)}</span>
            <span style="font-size:13px;color:var(--text-secondary)">${pEntries.length} act.</span>
            <span style="font-size:13px;color:var(--text-muted);font-family:var(--font-mono)">${pHours}h</span>
          </div>`;
        }).join('')}
      ` : ''}

      <p class="report-section-title">Todas las Actividades</p>
      <div class="report-entries">
        ${entries.length ? entries.map((e) => renderReportEntry(e)).join('') : '<p class="report-empty">Sin actividades esta semana.</p>'}
      </div>
    `;
  }

  function renderProjectReport() {
    const projectId = document.getElementById('reportProjectSelect').value;
    const container = document.getElementById('report-project-content');
    if (!projectId) {
      container.innerHTML = '<div class="report-empty">Selecciona un proyecto para ver su reporte.</div>';
      return;
    }

    const project = DB.projects.getById(projectId);
    if (!project) return;

    const objs = DB.objectives.getByProject(projectId);
    const progressLog = DB.progress.getByProject(projectId);
    const dailyWork = DB.daily.getByProject(projectId);
    const totalPct = DB.getProjectProgress(projectId);
    const doneObjs = objs.filter((o) => o.done).length;
    const progressHours = progressLog.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);
    const totalHours = dailyWork.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0) + progressHours;

    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid var(--border)">
        <div style="width:14px;height:14px;border-radius:50%;background:${project.color || 'var(--accent)'};flex-shrink:0"></div>
        <div>
          <h3 style="font-size:17px;font-weight:700;color:var(--text-primary)">${escHtml(project.name)}</h3>
          <p style="font-size:13px;color:var(--text-secondary)">${escHtml(project.description || '')}</p>
        </div>
        <span class="status-badge ${project.status || 'active'}" style="margin-left:auto">${statusLabel(project.status)}</span>
      </div>

      <div class="report-summary">
        <div class="report-stat"><span class="report-stat-num">${totalPct}%</span><span class="report-stat-label">Avance total</span></div>
        <div class="report-stat"><span class="report-stat-num">${doneObjs}/${objs.length}</span><span class="report-stat-label">Objetivos</span></div>
        <div class="report-stat"><span class="report-stat-num">${progressLog.length}</span><span class="report-stat-label">Avances registrados</span></div>
        <div class="report-stat"><span class="report-stat-num">${totalHours}h</span><span class="report-stat-label">Horas registradas</span></div>
      </div>

      <div style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;font-size:13px;color:var(--text-secondary);margin-bottom:6px">
          <span>Progreso general</span><span style="font-weight:600;color:var(--text-primary)">${totalPct}%</span>
        </div>
        <div class="project-progress-bar" style="height:10px">
          <div class="project-progress-fill" style="width:${totalPct}%;background:${project.color || 'var(--accent)'}"></div>
        </div>
      </div>

      ${objs.length ? `
        <p class="report-section-title">Objetivos</p>
        ${objs.map((o) => `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="width:8px;height:8px;border-radius:50%;background:${o.done ? 'var(--green)' : o.priority === 'high' ? 'var(--red)' : 'var(--amber)'};flex-shrink:0"></div>
            <span style="flex:1;font-size:14px;color:${o.done ? 'var(--text-muted)' : 'var(--text-primary)'};${o.done ? 'text-decoration:line-through' : ''}">${escHtml(o.title)}</span>
            <span style="font-size:13px;font-family:var(--font-mono);color:var(--accent)">${o.progress || 0}%</span>
            ${o.done ? '<span style="font-size:11px;color:var(--green);font-weight:600">OK</span>' : ''}
          </div>`).join('')}
      ` : ''}

      ${progressLog.length ? `
        <p class="report-section-title">Historial de Avances</p>
        <div class="progress-entries">
          ${progressLog.map((e) => {
            const imgSrc = e.fileId ? DB.files.get(e.fileId) : null;
            const isPdf = isPdfRef(imgSrc);
            return `<div class="progress-entry">
              <div class="progress-entry-dot"></div>
              <div class="progress-entry-content">
                <p class="progress-entry-text">${escHtml(e.description)}</p>
                <div class="progress-entry-meta">${UI.fmtDate(e.date)} - ${e.percent}% avance${e.hours ? ` - ${e.hours}h` : ''}</div>
              </div>
              ${imgSrc && !isPdf ? `<img src="${imgSrc}" class="progress-entry-img" onclick="UI.lightbox('${imgSrc}')" alt="Evidencia" style="cursor:pointer">` : ''}
              ${imgSrc && isPdf ? `<a href="${imgSrc}" target="_blank" rel="noopener" class="btn-ghost" style="align-self:flex-start">Ver PDF</a>` : ''}
            </div>`;
          }).join('')}
        </div>
      ` : ''}

      ${dailyWork.length ? `
        <p class="report-section-title">Trabajo Diario Relacionado (${dailyWork.length} entradas)</p>
        <div class="report-entries">
          ${dailyWork.map((e) => renderReportEntry({ ...e, entryType: 'daily' })).join('')}
        </div>
      ` : ''}
    `;
  }

  function renderReportEntry(e) {
    const proj = e.projectId ? DB.projects.getById(e.projectId) : null;
    const imgSrc = e.fileId ? DB.files.get(e.fileId) : null;
    const isPdf = isPdfRef(imgSrc);
    const isProgress = e.entryType === 'progress';
    const title = isProgress ? (e.description || 'Avance de proyecto') : (e.title || 'Actividad');

    return `<div class="report-entry">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <p class="report-entry-title">${escHtml(title)}</p>
          <div class="report-entry-meta">
            <span>${UI.fmtDate(e.date)}</span>
            ${e.hours ? `<span>h ${e.hours}</span>` : ''}
            ${isProgress ? `<span>${e.percent || 0}% avance</span>` : ''}
            ${!isProgress && e.category ? `<span>${e.category}</span>` : ''}
            ${proj ? `<span style="color:${proj.color || 'var(--accent)'}">${escHtml(proj.name)}</span>` : ''}
          </div>
        </div>
        ${imgSrc && !isPdf ? `<img src="${imgSrc}" style="width:60px;height:45px;object-fit:cover;border-radius:6px;flex-shrink:0;cursor:pointer" onclick="UI.lightbox('${imgSrc}')" alt="Imagen">` : ''}
        ${imgSrc && isPdf ? `<a href="${imgSrc}" target="_blank" rel="noopener" class="btn-ghost">Ver PDF</a>` : ''}
      </div>
      ${!isProgress && e.description ? `<p class="report-entry-desc">${escHtml(e.description)}</p>` : ''}
    </div>`;
  }

  function renderCategoryBreakdown(byCategory) {
    const colors = { desarrollo: '#4F6EF7', diseno: '#8B5CF6', reunion: '#F59E0B', investigacion: '#06B6D4', otro: '#6B7280', avance: '#4F6EF7' };
    const total = Object.values(byCategory).reduce((s, v) => s + v, 0);
    return `
      <p class="report-section-title">Por Categoria</p>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        ${Object.entries(byCategory).map(([cat, count]) => `
          <div style="background:${colors[cat] || '#6B7280'}20;border:1px solid ${colors[cat] || '#6B7280'}33;border-radius:99px;padding:5px 12px;font-size:13px;color:${colors[cat] || '#6B7280'}">
            ${cat} - <strong>${count}</strong> <span style="opacity:0.7">(${Math.round((count / total) * 100)}%)</span>
          </div>`).join('')}
      </div>`;
  }

  function statusLabel(s) {
    return { active: 'Activo', paused: 'Pausado', completed: 'Completado' }[s] || 'Activo';
  }

  function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function isPdfRef(src) {
    const s = String(src || '');
    if (!s) return false;
    return s.startsWith('data:application/pdf') || /\.pdf($|[?#])/i.test(s);
  }

  return { init, refresh };
})();
