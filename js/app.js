/* app.js â€” Main Application Bootstrap & Dashboard */
'use strict';

const App = (() => {
  function isReadOnly() {
    return !!window.AppMode?.isReadOnly?.();
  }

  /* ---- DASHBOARD ---- */
  function refreshDashboard() {
    const projects = DB.projects.getAll();
    const activeProjects = projects.filter(p => p.status === 'active');
    const allObjs = DB.objectives.getAll();
    const doneObjs = allObjs.filter(o => o.done);
    const week = DB.getWeekDates();
    const weekEntries = DB.getActivityByWeek(week.start, week.end);
    const weekHours = weekEntries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);

    document.getElementById('stat-projects').textContent = activeProjects.length;
    document.getElementById('stat-objectives').textContent = doneObjs.length;
    document.getElementById('stat-entries').textContent = weekEntries.length;
    document.getElementById('stat-hours').textContent = weekHours + 'h';

    // Recent projects
    const dashProjList = document.getElementById('dash-projects-list');
    const recentProjects = projects.slice(0, 5);
    if (!recentProjects.length) {
      dashProjList.innerHTML = `<div class="empty-state">
        <p>Sin proyectos. <button class="btn-ghost" onclick="Projects.openNew()">Crear proyecto</button></p>
      </div>`;
    } else {
      dashProjList.innerHTML = recentProjects.map(p => {
        const pct = DB.getProjectProgress(p.id);
        return `<div class="dash-item" onclick="Projects.openDetail('${p.id}')">
          <div class="dash-item-dot" style="background:${p.color||'#4F6EF7'}"></div>
          <div class="dash-item-info">
            <div class="dash-item-name">${escHtml(p.name)}</div>
            <div class="dash-item-meta">${pct}% avance Â· <span style="color:${statusColor(p.status)}">${statusLabel(p.status)}</span></div>
          </div>
        </div>`;
      }).join('');
    }

    // Recent activity
    const dashActivity = document.getElementById('dash-activity-list');
    const recentEntries = DB.getActivityEntries().slice(0, 6);
    if (!recentEntries.length) {
      dashActivity.innerHTML = `<div class="empty-state"><p>Sin entradas recientes.</p></div>`;
    } else {
      dashActivity.innerHTML = recentEntries.map(e => {
        const proj = e.projectId ? DB.projects.getById(e.projectId) : null;
        const name = e.entryType === 'progress' ? (e.description || 'Avance de proyecto') : e.title;
        return `<div class="dash-item">
          <div class="dash-item-dot" style="background:${proj?.color||'#545e6e'}"></div>
          <div class="dash-item-info">
            <div class="dash-item-name">${escHtml(name)}</div>
            <div class="dash-item-meta">${UI.fmtDateShort(e.date)} ${e.hours ? 'Â· ' + e.hours + 'h' : ''} ${proj ? 'Â· ' + escHtml(proj.name) : ''}</div>
          </div>
        </div>`;
      }).join('');
    }

    // Upcoming objective deliveries
    const dashObjectives = document.getElementById('dash-objectives-list');
    if (dashObjectives) {
      const pendingObjectives = DB.objectives.getAll()
        .filter((o) => !o.done && o.deadline)
        .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
        .slice(0, 8);

      if (!pendingObjectives.length) {
        dashObjectives.innerHTML = `<div class="empty-state"><p>No hay objetivos con fecha limite pendiente.</p></div>`;
      } else {
        dashObjectives.innerHTML = pendingObjectives.map((o) => {
          const project = DB.projects.getById(o.projectId);
          const due = daysUntil(o.deadline);
          const dueLabel = due < 0
            ? `Atrasado ${Math.abs(due)} dia${Math.abs(due) !== 1 ? 's' : ''}`
            : due === 0
              ? 'Vence hoy'
              : due === 1
                ? 'Vence manana'
                : `Faltan ${due} dias`;
          const dueColor = due < 0 ? 'var(--red)' : due <= 1 ? 'var(--amber)' : 'var(--text-secondary)';
          return `<div class="dash-item" onclick="Projects.openDetail('${o.projectId}')">
            <div class="dash-item-dot" style="background:${project?.color || '#4F6EF7'}"></div>
            <div class="dash-item-info">
              <div class="dash-item-name">${escHtml(o.title)}</div>
              <div class="dash-item-meta">${project ? escHtml(project.name) + ' · ' : ''}${UI.fmtDateShort(o.deadline)} · <span style="color:${dueColor}">${dueLabel}</span></div>
            </div>
          </div>`;
        }).join('');
      }
    }

    // Weekly chart
    renderWeeklyChart(week);
    if (window.DeadlineNotifications?.updateBadge) DeadlineNotifications.updateBadge();
  }

  function renderWeeklyChart(week) {
    const dayNames = ['L','M','X','J','V','S','D'];
    const allEntries = DB.getActivityEntries();
    const hoursPerDay = week.days.map(day =>
      allEntries.filter(e => e.date === day).reduce((s, e) => s + (parseFloat(e.hours) || 0), 0)
    );
    const maxH = Math.max(...hoursPerDay, 1);
    const today = new Date().toISOString().split('T')[0];

    document.getElementById('weeklyChart').innerHTML = week.days.map((day, i) => {
      const h = hoursPerDay[i];
      const barH = Math.max(Math.round((h / maxH) * 90), h > 0 ? 6 : 2);
      const isToday = day === today;
      return `<div class="week-bar-wrap">
        <div class="week-bar-hours">${h > 0 ? h + 'h' : ''}</div>
        <div class="week-bar ${h > 0 ? 'has-data' : ''}" style="height:${barH}px;${isToday && h > 0 ? 'box-shadow:0 0 8px rgba(79,110,247,0.4)' : ''}"></div>
        <div class="week-bar-label" style="${isToday ? 'color:var(--accent);font-weight:600' : ''}">${dayNames[i]}</div>
      </div>`;
    }).join('');
  }

  /* ---- INIT ---- */
  async function init() {
    if (window.Auth && Auth.enforce) {
      await Auth.enforce();
    }

    if (window.SupabaseStorage) SupabaseStorage.fillSettingsForm();
    if (window.SupabaseData && window.SupabaseStorage && SupabaseStorage.isConfigured()) {
      try { await SupabaseData.hydrateLocal(); } catch (_) {}
    }

    // Set date display
    const now = new Date();
    const opts = { weekday:'long', year:'numeric', month:'long', day:'numeric' };
    document.getElementById('currentDate').textContent = now.toLocaleDateString('es-MX', opts);
    document.getElementById('todayDate').textContent = UI.fmtDate(now.toISOString().split('T')[0]);

    // Navigation
    document.querySelectorAll('[data-view]').forEach(el => {
      el.addEventListener('click', () => {
        const view = el.dataset.view;
        UI.navigate(view);
      });
    });

    // Sidebar toggle (mobile)
    document.getElementById('menuBtn').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    document.getElementById('sidebarToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Close sidebar on overlay click
    document.getElementById('modalOverlay').addEventListener('click', UI.closeAllModals);

    // Close modal buttons
    document.querySelectorAll('.modal-close, [data-modal]').forEach(btn => {
      btn.addEventListener('click', () => {
        const id = btn.dataset.modal;
        if (id) UI.closeModal(id);
      });
    });

    // Quick add button
    if (!isReadOnly()) {
      document.getElementById('quickAddBtn').addEventListener('click', () => UI.openModal('quickAddModal'));
      document.getElementById('qa-project').addEventListener('click', () => {
        UI.closeModal('quickAddModal');
        Projects.openNew();
      });
      document.getElementById('qa-daily').addEventListener('click', () => {
        UI.closeModal('quickAddModal');
        UI.navigate('daily');
      });
    } else {
      const qa = document.getElementById('quickAddBtn');
      if (qa) qa.style.display = 'none';
      const voice = document.getElementById('globalVoiceBtn');
      if (voice) voice.style.display = 'none';
    }

    // View handlers
    window.ViewHandlers = {
      dashboard: refreshDashboard,
      projects: () => Projects.renderGrid(),
      daily: () => Daily.refresh(),
      reports: () => Reports.refresh(),
      'project-detail': (id) => { if (id) { const p = DB.projects.getById(id); if (p) Projects.openDetail(id); } }
    };

    // Initialize modules
    Projects.init();
    Daily.init();
    Reports.init();
    if (window.AIVoice?.init) AIVoice.init();
    if (window.VoiceAutomation?.init) VoiceAutomation.init();
    if (window.AIDescriptions?.init) AIDescriptions.init();
    if (window.DeadlineNotifications?.init) DeadlineNotifications.init();

    // Initial render
    refreshDashboard();

    // Allow deep-link opening from PWA shortcuts: ?view=projects|daily|reports
    const viewFromUrl = new URLSearchParams(window.location.search).get('view');
    if (viewFromUrl && ['dashboard', 'projects', 'daily', 'reports'].includes(viewFromUrl)) {
      UI.navigate(viewFromUrl);
    }
  }

  function escHtml(str) {
    return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function statusColor(s) {
    return { active:'var(--green)', paused:'var(--amber)', completed:'var(--accent)' }[s] || 'var(--text-muted)';
  }

  function statusLabel(s) {
    return { active:'Activo', paused:'Pausado', completed:'Completado' }[s] || 'Activo';
  }

  function daysUntil(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(String(dateStr || '') + 'T00:00:00');
    due.setHours(0, 0, 0, 0);
    const diff = due.getTime() - today.getTime();
    return Math.round(diff / 86400000);
  }

  document.addEventListener('DOMContentLoaded', init);
  return { refreshDashboard };
})();

/* Settings wiring â€” added after initial module */
App.openSettings = function() {
  if (window.AppMode?.isReadOnly?.()) return;
  UI.openModal('settingsModal');
};

document.addEventListener('DOMContentLoaded', () => {
  // Import file input
  const importInput = document.getElementById('importFileInput');
  if (importInput) {
    importInput.addEventListener('change', () => {
      if (importInput.files[0]) DataUtils.importData(importInput.files[0]);
    });
  }
  // Wire settingsModal close
  document.querySelector('[data-modal="settingsModal"]')?.addEventListener('click', () => UI.closeModal('settingsModal'));
});



