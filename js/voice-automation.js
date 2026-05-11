/* voice-automation.js - Global voice automation for full app control */
'use strict';

const VoiceAutomation = (() => {
  let recognition = null;
  let recorder = null;
  let mediaStream = null;
  let chunks = [];
  let stopTimer = null;
  let isRecording = false;
  let isBusy = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function norm(v) {
    return String(v || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  }

  function esc(v) {
    return String(v || '').replace(/[<>&]/g, '');
  }

  function setRecordingUi(on) {
    const btn = byId('globalVoiceBtn');
    if (!btn) return;
    btn.classList.toggle('recording', !!on);
    btn.innerHTML = on
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg><span>Detener voz</span>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 10.5a7 7 0 0014 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg><span>Voz IA</span>';
  }

  function toast(msg, error = false) {
    UI.toast(msg, error ? 'error' : 'default');
  }

  function gatherContext() {
    const projects = DB.projects.getAll();
    const objectives = DB.objectives.getAll();
    const progress = DB.progress.getAll().slice(0, 120);
    const daily = DB.daily.getAll().slice(0, 120);

    return {
      currentView: window._currentView || 'dashboard',
      activeProjectId: window._activeProjectId || null,
      today: new Date().toISOString().split('T')[0],
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status || 'active'
      })),
      objectives: objectives.map((o) => ({
        id: o.id,
        title: o.title,
        projectId: o.projectId,
        done: !!o.done,
        progress: Number(o.progress || 0)
      })),
      progress: progress.map((e) => ({
        id: e.id,
        description: String(e.description || '').slice(0, 120),
        projectId: e.projectId,
        objectiveId: e.objectiveId || null,
        percent: Number(e.percent || 0),
        hours: Number(e.hours || 0),
        date: e.date
      })),
      daily: daily.map((e) => ({
        id: e.id,
        title: String(e.title || '').slice(0, 120),
        projectId: e.projectId || null,
        category: e.category || 'otro',
        date: e.date
      }))
    };
  }

  function sanitizePlan(raw, transcript) {
    const plan = raw?.plan || raw || {};
    const actionsRaw = Array.isArray(plan.actions) ? plan.actions : [];
    const actions = actionsRaw
      .map(sanitizeAction)
      .filter(Boolean)
      .slice(0, 10);
    return {
      summary: String(plan.summary || transcript || 'Sin resumen'),
      actions
    };
  }

  function sanitizeAction(a) {
    if (!a || typeof a !== 'object') return null;
    const type = String(a.type || '').trim();
    const payload = a.payload && typeof a.payload === 'object' ? a.payload : {};

    const allowed = [
      'navigate', 'create_project', 'update_project', 'delete_project',
      'create_objective', 'update_objective', 'toggle_objective_done', 'delete_objective',
      'add_progress', 'delete_progress',
      'add_daily', 'update_daily', 'delete_daily',
      'report_view',
      'open_settings', 'sync_supabase', 'verify_supabase', 'logout'
    ];
    if (!allowed.includes(type)) return null;
    return { type, payload };
  }

  async function planWithAI(transcript) {
    const client = window.SupabaseStorage?.getClient?.();
    if (!client) throw new Error('Supabase no configurado');

    const aiCfg = window.SupabaseStorage?.getAIConfig?.() || {};
    const context = gatherContext();
    const res = await client.functions.invoke('ai-voice-command', {
      body: {
        transcript,
        context,
        ollama_api_key: aiCfg.ollamaKey || undefined,
        ollama_model: aiCfg.ollamaModel || undefined
      }
    });
    if (res?.error) throw res.error;
    return sanitizePlan(res?.data, transcript);
  }

  function firstSentence(text, fallback = '') {
    const t = String(text || '').trim();
    if (!t) return fallback;
    return t.split(/[.!?\n]/)[0].slice(0, 120).trim() || fallback;
  }

  function fallbackPlan(transcript) {
    const n = norm(transcript);
    const actions = [];

    if (n.includes('dashboard')) actions.push({ type: 'navigate', payload: { view: 'dashboard' } });
    if (n.includes('proyecto') && (n.includes('ver') || n.includes('abrir'))) actions.push({ type: 'navigate', payload: { view: 'projects' } });
    if (n.includes('trabajo diario') || n.includes('diario')) actions.push({ type: 'navigate', payload: { view: 'daily' } });
    if (n.includes('reporte')) actions.push({ type: 'navigate', payload: { view: 'reports' } });
    if (n.includes('configuracion') || n.includes('ajustes')) actions.push({ type: 'open_settings', payload: {} });
    if (n.includes('sincroniza') || n.includes('sincronizar') || n.includes('sync')) actions.push({ type: 'sync_supabase', payload: {} });
    if (n.includes('verifica nube') || n.includes('verificar nube')) actions.push({ type: 'verify_supabase', payload: {} });
    if (n.includes('cerrar sesion')) actions.push({ type: 'logout', payload: {} });

    if (n.includes('crear proyecto') || n.includes('crea proyecto') || (n.includes('crea') && n.includes('proyecto')) || n.includes('nuevo proyecto')) {
      actions.push({
        type: 'create_project',
        payload: {
          name: firstSentence(transcript, 'Nuevo proyecto'),
          description: transcript,
          status: 'active'
        }
      });
    } else if (n.includes('agrega') || n.includes('agregar') || n.includes('registra')) {
      actions.push({
        type: 'add_daily',
        payload: {
          title: firstSentence(transcript, 'Registro diario'),
          description: transcript,
          date: new Date().toISOString().split('T')[0],
          category: n.includes('soporte') ? 'otro' : 'desarrollo'
        }
      });
    }

    if (!actions.length) {
      actions.push({
        type: 'add_daily',
        payload: {
          title: firstSentence(transcript, 'Registro diario'),
          description: transcript,
          date: new Date().toISOString().split('T')[0],
          category: 'otro'
        }
      });
    }

    return {
      summary: `Comando detectado: ${transcript}`,
      actions
    };
  }

  function findProject(ref) {
    const projects = DB.projects.getAll();
    if (!ref) return null;
    if (typeof ref === 'object') {
      if (ref.id) {
        const byId = projects.find((p) => p.id === String(ref.id));
        if (byId) return byId;
      }
      ref = ref.name || '';
    }
    const token = String(ref || '').trim();
    if (!token) return null;
    const byId = projects.find((p) => p.id === token);
    if (byId) return byId;
    const n = norm(token);
    return projects.find((p) => norm(p.name) === n || norm(p.name).includes(n)) || null;
  }

  function findObjective(ref, projectId = null) {
    const all = DB.objectives.getAll().filter((o) => !projectId || o.projectId === projectId);
    if (!ref) return null;
    if (typeof ref === 'object') {
      if (ref.id) {
        const byId = all.find((o) => o.id === String(ref.id));
        if (byId) return byId;
      }
      ref = ref.title || ref.name || '';
    }
    const token = String(ref || '').trim();
    if (!token) return null;
    const byId = all.find((o) => o.id === token);
    if (byId) return byId;
    const n = norm(token);
    return all.find((o) => norm(o.title) === n || norm(o.title).includes(n)) || null;
  }

  function findDailyEntry(ref) {
    const all = DB.daily.getAll();
    if (!ref) return null;
    if (typeof ref === 'object') {
      if (ref.id) return all.find((e) => e.id === String(ref.id)) || null;
      ref = ref.title || '';
    }
    const token = String(ref || '').trim();
    if (!token) return null;
    const byId = all.find((e) => e.id === token);
    if (byId) return byId;
    const n = norm(token);
    return all.find((e) => norm(e.title).includes(n)) || null;
  }

  function findProgressEntry(ref, objectiveId = null, projectId = null) {
    const all = DB.progress.getAll().filter((e) => (!objectiveId || e.objectiveId === objectiveId) && (!projectId || e.projectId === projectId));
    if (!ref) return null;
    if (typeof ref === 'object') {
      if (ref.id) return all.find((e) => e.id === String(ref.id)) || null;
      ref = ref.description || '';
    }
    const token = String(ref || '').trim();
    if (!token) return null;
    const byId = all.find((e) => e.id === token);
    if (byId) return byId;
    const n = norm(token);
    return all.find((e) => norm(e.description).includes(n)) || null;
  }

  function categoryOf(raw) {
    const n = norm(raw);
    if (n.includes('desarrollo') || n === 'dev') return 'desarrollo';
    if (n.includes('diseno') || n.includes('dise')) return 'diseno';
    if (n.includes('reunion') || n.includes('meeting') || n.includes('junta')) return 'reunion';
    if (n.includes('investig')) return 'investigacion';
    return 'otro';
  }

  function reportTypeOf(raw) {
    const n = norm(raw);
    if (n.includes('weekly') || n.includes('seman')) return 'weekly';
    if (n.includes('project') || n.includes('proyecto')) return 'project';
    return 'daily';
  }

  function normalizeDate(v) {
    const s = String(v || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return new Date().toISOString().split('T')[0];
  }

  async function ensureDescriptionFromTitle(title, description, kind) {
    const t = String(title || '').trim();
    const d = String(description || '').trim();
    if (d) return d;
    if (!t) return d;
    if (window.AIDescriptions?.generateDescription) {
      try {
        return await AIDescriptions.generateDescription(t, kind);
      } catch (_) {
        return d;
      }
    }
    return d;
  }

  async function executeAction(action) {
    const p = action.payload || {};
    switch (action.type) {
      case 'navigate': {
        const view = ['dashboard', 'projects', 'daily', 'reports', 'project-detail'].includes(String(p.view)) ? p.view : 'dashboard';
        if (view === 'project-detail') {
          const project = findProject(p.project_ref || p.project_id || p.project_name);
          if (project) Projects.openDetail(project.id);
          else UI.navigate('projects');
          return;
        }
        UI.navigate(view);
        return;
      }
      case 'create_project': {
        const name = String(p.name || '').trim();
        if (!name) return;
        const description = await ensureDescriptionFromTitle(name, p.description, 'project');
        DB.projects.add({
          name,
          description,
          status: ['active', 'paused', 'completed'].includes(String(p.status)) ? p.status : 'active',
          color: String(p.color || '#4F6EF7'),
          startDate: p.start_date ? normalizeDate(p.start_date) : '',
          endDate: p.end_date ? normalizeDate(p.end_date) : ''
        });
        return;
      }
      case 'update_project': {
        const project = findProject(p.project_ref || p.project_id || p.project_name);
        if (!project) return;
        const patch = {};
        if (p.name) patch.name = String(p.name).trim();
        if (p.description !== undefined || p.name) {
          patch.description = await ensureDescriptionFromTitle(
            p.name || project.name,
            p.description,
            'project'
          );
        }
        if (p.status && ['active', 'paused', 'completed'].includes(String(p.status))) patch.status = String(p.status);
        if (p.color) patch.color = String(p.color);
        if (p.start_date) patch.startDate = normalizeDate(p.start_date);
        if (p.end_date) patch.endDate = normalizeDate(p.end_date);
        DB.projects.update(project.id, patch);
        return;
      }
      case 'delete_project': {
        const project = findProject(p.project_ref || p.project_id || p.project_name);
        if (!project) return;
        DB.projects.delete(project.id);
        return;
      }
      case 'create_objective': {
        const project = findProject(p.project_ref || p.project_id || p.project_name || window._activeProjectId);
        const title = String(p.title || '').trim();
        if (!project || !title) return;
        const description = await ensureDescriptionFromTitle(title, p.description, 'objective');
        DB.objectives.add({
          projectId: project.id,
          title,
          description,
          priority: ['low', 'medium', 'high'].includes(String(p.priority)) ? String(p.priority) : 'medium',
          deadline: p.deadline ? normalizeDate(p.deadline) : '',
          progress: Number.isFinite(Number(p.progress)) ? Math.max(0, Math.min(100, Number(p.progress))) : 0
        });
        return;
      }
      case 'update_objective': {
        const project = findProject(p.project_ref || p.project_id || p.project_name || null);
        const objective = findObjective(p.objective_ref || p.objective_id || p.objective_title, project?.id || null);
        if (!objective) return;
        const patch = {};
        if (p.title) patch.title = String(p.title).trim();
        if (p.description !== undefined || p.title) {
          patch.description = await ensureDescriptionFromTitle(
            p.title || objective.title,
            p.description,
            'objective'
          );
        }
        if (p.priority && ['low', 'medium', 'high'].includes(String(p.priority))) patch.priority = String(p.priority);
        if (p.deadline) patch.deadline = normalizeDate(p.deadline);
        if (p.progress !== undefined && Number.isFinite(Number(p.progress))) {
          const val = Math.max(0, Math.min(100, Number(p.progress)));
          patch.progress = val;
          patch.done = val >= 100;
        }
        DB.objectives.update(objective.id, patch);
        return;
      }
      case 'toggle_objective_done': {
        const project = findProject(p.project_ref || p.project_id || p.project_name || null);
        const objective = findObjective(p.objective_ref || p.objective_id || p.objective_title, project?.id || null);
        if (!objective) return;
        const done = p.done === undefined ? !objective.done : !!p.done;
        DB.objectives.update(objective.id, { done, progress: done ? 100 : objective.progress || 0 });
        return;
      }
      case 'delete_objective': {
        const project = findProject(p.project_ref || p.project_id || p.project_name || null);
        const objective = findObjective(p.objective_ref || p.objective_id || p.objective_title, project?.id || null);
        if (!objective) return;
        DB.objectives.delete(objective.id);
        return;
      }
      case 'add_progress': {
        const project = findProject(p.project_ref || p.project_id || p.project_name || window._activeProjectId);
        const objective = findObjective(p.objective_ref || p.objective_id || p.objective_title, project?.id || null);
        const description = String(p.description || '').trim();
        if (!description) return;
        const percent = Number.isFinite(Number(p.percent)) ? Math.max(0, Math.min(100, Number(p.percent))) : 0;
        const hours = Number.isFinite(Number(p.hours)) ? String(Math.max(0.5, Math.min(24, Number(p.hours)))) : '1';
        const projectId = project?.id || objective?.projectId;
        if (!projectId) return;
        DB.progress.add({
          projectId,
          objectiveId: objective?.id || null,
          description,
          percent,
          hours,
          date: p.date ? normalizeDate(p.date) : new Date().toISOString().split('T')[0]
        });
        if (objective) DB.objectives.update(objective.id, { progress: percent, done: percent >= 100 });
        return;
      }
      case 'delete_progress': {
        const project = findProject(p.project_ref || p.project_id || p.project_name || null);
        const objective = findObjective(p.objective_ref || p.objective_id || p.objective_title, project?.id || null);
        const entry = findProgressEntry(p.progress_ref || p.progress_id || p.description, objective?.id || null, project?.id || null);
        if (!entry) return;
        DB.progress.delete(entry.id);
        return;
      }
      case 'add_daily': {
        const project = findProject(p.project_ref || p.project_id || p.project_name);
        const title = String(p.title || '').trim();
        if (!title) return;
        const description = await ensureDescriptionFromTitle(title, p.description, 'daily');
        DB.daily.add({
          title,
          description,
          date: p.date ? normalizeDate(p.date) : new Date().toISOString().split('T')[0],
          hours: p.hours != null && p.hours !== '' ? String(Math.max(0.5, Math.min(24, Number(p.hours)))) : null,
          projectId: project?.id || null,
          category: categoryOf(p.category)
        });
        return;
      }
      case 'update_daily': {
        const entry = findDailyEntry(p.entry_ref || p.entry_id || p.title);
        if (!entry) return;
        const project = p.project_ref || p.project_id || p.project_name ? findProject(p.project_ref || p.project_id || p.project_name) : null;
        const patch = {};
        if (p.title) patch.title = String(p.title).trim();
        if (p.description !== undefined || p.title) {
          patch.description = await ensureDescriptionFromTitle(
            p.title || entry.title,
            p.description,
            'daily'
          );
        }
        if (p.date) patch.date = normalizeDate(p.date);
        if (p.hours !== undefined && p.hours !== null && p.hours !== '') patch.hours = String(Math.max(0.5, Math.min(24, Number(p.hours))));
        if (p.category) patch.category = categoryOf(p.category);
        if (project || p.project_ref === null || p.project_id === null) patch.projectId = project?.id || null;
        DB.daily.update(entry.id, patch);
        return;
      }
      case 'delete_daily': {
        const entry = findDailyEntry(p.entry_ref || p.entry_id || p.title);
        if (!entry) return;
        DB.daily.delete(entry.id);
        return;
      }
      case 'report_view': {
        UI.navigate('reports');
        const report = reportTypeOf(p.report || p.type);
        const reportBtn = document.querySelector(`.report-tab[data-report="${report}"]`);
        if (reportBtn instanceof HTMLElement) reportBtn.click();
        if (report === 'daily' && p.date) {
          const inp = byId('reportDailyDate');
          if (inp) {
            inp.value = normalizeDate(p.date);
            inp.dispatchEvent(new Event('change'));
          }
        }
        if (report === 'project') {
          const sel = byId('reportProjectSelect');
          const project = findProject(p.project_ref || p.project_id || p.project_name);
          if (sel && project) {
            sel.value = project.id;
            sel.dispatchEvent(new Event('change'));
          }
        }
        return;
      }
      case 'open_settings': {
        if (window.App?.openSettings) App.openSettings();
        return;
      }
      case 'sync_supabase': {
        if (!window.SupabaseData?.syncNow) throw new Error('Supabase sync no disponible');
        const counts = await SupabaseData.syncNow();
        toast(`Sync OK p:${counts.pf_projects} o:${counts.pf_objectives} a:${counts.pf_progress} d:${counts.pf_daily}`);
        return;
      }
      case 'verify_supabase': {
        if (!window.SupabaseData?.getCounts) throw new Error('Supabase verificacion no disponible');
        const counts = await SupabaseData.getCounts();
        toast(`Nube p:${counts.pf_projects} o:${counts.pf_objectives} a:${counts.pf_progress} d:${counts.pf_daily}`);
        return;
      }
      case 'logout': {
        if (window.Auth?.logout) Auth.logout();
        return;
      }
      default:
        return;
    }
  }

  async function refreshAllViews() {
    try { Projects.renderGrid(); } catch (_) {}
    try { Daily.refresh(); } catch (_) {}
    try { Reports.refresh(); } catch (_) {}
    try { App.refreshDashboard(); } catch (_) {}

    if (window._currentView === 'project-detail' && window._activeProjectId) {
      const p = DB.projects.getById(window._activeProjectId);
      if (p) Projects.openDetail(p.id);
      else UI.navigate('projects');
    }
  }

  function actionLabel(action) {
    const p = action.payload || {};
    switch (action.type) {
      case 'navigate': return `Navegar a ${p.view || 'dashboard'}`;
      case 'create_project': return `Crear proyecto: ${esc(p.name || 'sin nombre')}`;
      case 'update_project': return `Editar proyecto: ${esc(p.project_name || p.project_ref || p.project_id || '')}`;
      case 'delete_project': return `Eliminar proyecto: ${esc(p.project_name || p.project_ref || p.project_id || '')}`;
      case 'create_objective': return `Crear objetivo: ${esc(p.title || '')}`;
      case 'update_objective': return `Editar objetivo: ${esc(p.objective_title || p.objective_ref || p.objective_id || '')}`;
      case 'toggle_objective_done': return `Cambiar estado objetivo: ${esc(p.objective_title || p.objective_ref || p.objective_id || '')}`;
      case 'delete_objective': return `Eliminar objetivo: ${esc(p.objective_title || p.objective_ref || p.objective_id || '')}`;
      case 'add_progress': return `Registrar avance: ${esc(p.description || '')}`;
      case 'delete_progress': return `Eliminar avance: ${esc(p.progress_ref || p.progress_id || p.description || '')}`;
      case 'add_daily': return `Agregar trabajo diario: ${esc(p.title || '')}`;
      case 'update_daily': return `Editar trabajo diario: ${esc(p.entry_ref || p.entry_id || p.title || '')}`;
      case 'delete_daily': return `Eliminar trabajo diario: ${esc(p.entry_ref || p.entry_id || p.title || '')}`;
      case 'report_view': return `Abrir reporte: ${esc(p.report || p.type || 'daily')}`;
      case 'open_settings': return 'Abrir configuracion';
      case 'sync_supabase': return 'Sincronizar con Supabase';
      case 'verify_supabase': return 'Verificar datos en Supabase';
      case 'logout': return 'Cerrar sesion';
      default: return action.type;
    }
  }

  function buildConfirmText(transcript, plan) {
    const lines = [];
    lines.push(`Comando: "${String(transcript || '').trim()}"`);
    lines.push('');
    lines.push(`Resumen IA: ${plan.summary}`);
    lines.push('');
    lines.push('Acciones:');
    plan.actions.forEach((a, i) => lines.push(`${i + 1}. ${actionLabel(a)}`));
    lines.push('');
    lines.push('Se ejecutaran al confirmar.');
    return lines.join('\n');
  }

  async function handleTranscript(transcript) {
    if (!transcript) {
      toast('No se detecto texto por voz', true);
      return;
    }
    if (isBusy) return;
    isBusy = true;
    try {
      toast('Interpretando comando por voz...');
      let plan;
      try {
        plan = await planWithAI(transcript);
      } catch (_err) {
        plan = fallbackPlan(transcript);
      }

      if (!plan.actions.length) {
        toast('No se detectaron acciones para ejecutar', true);
        return;
      }

      const ok = await UI.confirm(buildConfirmText(transcript, plan), {
        title: 'Confirmar acciones por voz',
        confirmText: 'Ejecutar',
        cancelText: 'Cancelar'
      });
      if (!ok) {
        toast('Accion cancelada');
        return;
      }

      for (const action of plan.actions) {
        // eslint-disable-next-line no-await-in-loop
        await executeAction(action);
      }
      await refreshAllViews();
      toast('Comando ejecutado correctamente', false);
    } catch (err) {
      toast(`Error de automatizacion: ${err?.message || 'fallo inesperado'}`, true);
    } finally {
      isBusy = false;
    }
  }

  function initSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;
    recognition = new SR();
    recognition.lang = 'es-MX';
    recognition.interimResults = false;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      isRecording = true;
      setRecordingUi(true);
      toast('Escuchando comando...');
    };
    recognition.onerror = (ev) => {
      isRecording = false;
      setRecordingUi(false);
      toast(`Error de voz: ${ev?.error || 'desconocido'}`, true);
    };
    recognition.onend = () => {
      isRecording = false;
      setRecordingUi(false);
    };
    recognition.onresult = async (ev) => {
      const transcript = String(ev?.results?.[0]?.[0]?.transcript || '').trim();
      await handleTranscript(transcript);
    };

    return true;
  }

  async function transcribeAudio(audioBlob) {
    const client = window.SupabaseStorage?.getClient?.();
    if (!client) throw new Error('Supabase no configurado');

    let res = await client.functions.invoke('transcribe-note', { body: audioBlob });
    if (res?.error || !res?.data?.text) {
      const form = new FormData();
      form.append('audio', audioBlob, 'voice.webm');
      res = await client.functions.invoke('transcribe-note', { body: form });
    }
    if (res?.error) throw res.error;
    return String(res?.data?.text || '').trim();
  }

  async function startRecorderFallback() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('Tu navegador no soporta audio');
    }
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];

    let mimeType = 'audio/webm;codecs=opus';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = 'audio/webm';
    if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = '';

    recorder = mimeType ? new MediaRecorder(mediaStream, { mimeType }) : new MediaRecorder(mediaStream);
    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) chunks.push(ev.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(chunks, { type: recorder?.mimeType || 'audio/webm' });
      cleanupRecorder();
      isRecording = false;
      setRecordingUi(false);
      if (!blob.size) {
        toast('No se capturo audio', true);
        return;
      }
      try {
        toast('Transcribiendo audio...');
        const transcript = await transcribeAudio(blob);
        await handleTranscript(transcript);
      } catch (err) {
        toast(`Error de transcripcion: ${err?.message || 'fallo'}`, true);
      }
    };
    recorder.start();
    isRecording = true;
    setRecordingUi(true);
    stopTimer = setTimeout(() => {
      if (isRecording) stopRecording();
    }, 60000);
  }

  function cleanupRecorder() {
    clearTimeout(stopTimer);
    stopTimer = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    recorder = null;
  }

  async function startRecording() {
    if (isBusy) return;
    if (recognition) {
      try { recognition.start(); } catch (_) {}
      return;
    }
    await startRecorderFallback();
  }

  function stopRecording() {
    if (recognition) {
      try { recognition.stop(); } catch (_) {}
      return;
    }
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
    }
  }

  function init() {
    const btn = byId('globalVoiceBtn');
    if (!btn) return;

    initSpeechRecognition();
    btn.addEventListener('click', async () => {
      if (isRecording) stopRecording();
      else {
        try {
          await startRecording();
        } catch (err) {
          toast(`No se pudo iniciar voz: ${err?.message || 'error'}`, true);
          isRecording = false;
          setRecordingUi(false);
        }
      }
    });
  }

  return { init };
})();

if (typeof window !== 'undefined') {
  window.VoiceAutomation = VoiceAutomation;
}
