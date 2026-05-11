import { corsHeaders } from './_shared/cors.ts';

type Project = { id: string; name: string; status?: string };
type Objective = { id: string; title: string; projectId: string; done?: boolean; progress?: number };
type ProgressEntry = { id: string; description?: string; projectId?: string; objectiveId?: string | null; percent?: number; hours?: number; date?: string };
type DailyEntry = { id: string; title?: string; projectId?: string | null; category?: string; date?: string };

type Context = {
  currentView?: string;
  activeProjectId?: string | null;
  today?: string;
  projects?: Project[];
  objectives?: Objective[];
  progress?: ProgressEntry[];
  daily?: DailyEntry[];
};

type Payload = {
  transcript?: string;
  context?: Context;
  ollama_api_key?: string;
  ollama_model?: string;
};

type Action = {
  type: string;
  payload?: Record<string, unknown>;
};

type Plan = {
  summary: string;
  actions: Action[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function normalize(v: unknown) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function cleanProjectName(raw: unknown, transcript = '') {
  let s = String(raw || '').trim();
  if (!s) s = String(transcript || '').trim();
  s = s
    .replace(/^(crear|crea|nuevo|nueva|agregar|agrega|registrar|registra)\s+/i, '')
    .replace(/^proyecto\s+/i, '')
    .replace(/^llamado\s+/i, '');
  s = s.split(/\b(objetivo|objetivos|meta|metas|tarea|tareas|avance|avances)\b/i)[0] || s;
  s = s.split(/\s+y\s+objetivo\b/i)[0] || s;
  s = s.replace(/\s+y\s*$/i, '');
  s = s.replace(/["'`]/g, '').trim();
  return s.slice(0, 140) || 'Nuevo proyecto';
}

function cleanObjectiveTitle(raw: unknown, transcript = '') {
  let s = String(raw || '').trim();
  if (!s) s = String(transcript || '').trim();
  s = s
    .replace(/^(crear|crea|agregar|agrega|registrar|registra)\s+/i, '')
    .replace(/^objetivo\s+/i, '')
    .replace(/^llamado\s+/i, '');
  s = s.split(/\b(proyecto|avance|avances)\b/i)[0] || s;
  s = s.replace(/["'`]/g, '').trim();
  return s.slice(0, 200) || 'Nuevo objetivo';
}

function objectiveHintFromTranscript(transcript: string) {
  const m = transcript.match(/objetivo(?:s)?(?:\s+[:\-]|\s+)(.+)$/i);
  if (!m) return '';
  return cleanObjectiveTitle(m[1] || '');
}

function splitObjectives(raw: string): string[] {
  const text = String(raw || '').trim();
  if (!text) return [];
  return text
    .replace(/\s+/g, ' ')
    .replace(/^\s*(objetivos?|metas?)\s*[:\-]?\s*/i, '')
    .split(/\n|;|\||,|\s+y\s+/gi)
    .map((s) => cleanObjectiveTitle(s))
    .map((s) => s.replace(/^\s*(objetivos?|metas?|obj\.?)\s*/i, '').trim())
    .map((s) => s.replace(/^\d+[\).\-\s]+/, '').trim())
    .filter((s) => !!s && s.toLowerCase() !== 'objetivos');
}

function parseBundleFields(transcript: string) {
  const t = String(transcript || '');
  const titleMatch = t.match(/(?:titulo|title|proyecto)\s*:\s*([^\n;|]+)/i);
  const descMatch = t.match(/(?:descripcion|descripci[oó]n|desc)\s*:\s*([^\n;|]+)/i);
  const objMatch = t.match(/(?:objetivos?)\s*:\s*([\s\S]+)/i);
  if (!titleMatch && !objMatch) return null;
  const title = cleanProjectName(titleMatch?.[1] || '', t);
  const description = String(descMatch?.[1] || '').trim();
  const objectives = splitObjectives(objMatch?.[1] || '');
  return { title, description, objectives };
}
function parseUnifiedProjectBundle(transcript: string) {
  const raw = String(transcript || '').trim();
  if (!raw) return null;
  const labeled = parseBundleFields(raw);
  if (labeled) return labeled;
  if (!/\bproyecto\b/i.test(raw)) return null;
  let work = raw.replace(/\s+/g, ' ').trim();
  work = work.replace(/^.*?\bproyecto\b\s*/i, '').trim();
  if (!work) return null;
  let objectivesChunk = '';
  let mainChunk = work;
  const objMatch = work.match(/\b(?:y\s+)?objetivos?\b\s*[:\-]?\s*(.+)$/i);
  if (objMatch) {
    objectivesChunk = String(objMatch[1] || '').trim();
    mainChunk = work.slice(0, objMatch.index).trim();
  }
  let description = '';
  const descMatch = mainChunk.match(/\b(?:descripcion|descripci[oó]n|desc)\b\s*[:\-]?\s*(.+)$/i);
  if (descMatch) {
    description = String(descMatch[1] || '').trim();
    mainChunk = mainChunk.slice(0, descMatch.index).trim();
  }
  if (!description) {
    const connectorMatch = mainChunk.match(/^(.+?)\s+(?:para|con)\s+(.+)$/i);
    if (connectorMatch) {
      mainChunk = String(connectorMatch[1] || '').trim();
      description = String(connectorMatch[2] || '').trim();
    }
  }
  const title = cleanProjectName(mainChunk || raw, raw);
  let objectives = splitObjectives(objectivesChunk);
  if (!objectives.length) {
    const hinted = objectiveHintFromTranscript(raw);
    if (hinted) objectives = [hinted];
  }
  if (!title) return null;
  return { title, description, objectives };
}

function sanitizeActions(actions: Action[], transcript: string): Action[] {
  return actions.map((action) => {
    const payload = action.payload && typeof action.payload === 'object' ? { ...action.payload } : {};
    if (action.type === 'create_project') {
      payload.name = cleanProjectName(payload.name, transcript);
    }
    if (action.type === 'create_objective') {
      payload.title = cleanObjectiveTitle(payload.title, transcript);
      if (!payload.project_name && !payload.project_id && !payload.project_ref) {
        payload.project_name = cleanProjectName('', transcript);
      }
    }
    if (action.type === 'add_progress') {
      const h = Number(payload.hours);
      payload.hours = Number.isFinite(h) ? Math.max(0.5, Math.min(24, h)) : 1;
    }
    return { ...action, payload };
  });
}

function enrichActionsFromTranscript(actions: Action[], transcript: string): Action[] {
  const bundle = parseUnifiedProjectBundle(transcript);
  if (!bundle) return actions;
  const output = actions.map((a) => ({
    ...a,
    payload: a.payload && typeof a.payload === 'object' ? { ...a.payload } : {}
  }));
  const firstProjectIdx = output.findIndex((a) => a.type === 'create_project');
  if (firstProjectIdx < 0) return output.slice(0, 10);
  const firstProjectPayload = output[firstProjectIdx].payload as Record<string, unknown>;
  const fixedName = cleanProjectName(firstProjectPayload.name || bundle.title, transcript);
  firstProjectPayload.name = fixedName;
  if (!firstProjectPayload.description || !String(firstProjectPayload.description).trim()) {
    firstProjectPayload.description = bundle.description || transcript;
  }
  const hasCreateObjective = output.some((a) => a.type === 'create_objective');
  if (!hasCreateObjective) {
    for (const title of bundle.objectives.slice(0, 10)) {
      output.push({
        type: 'create_objective',
        payload: {
          project_name: fixedName,
          title: cleanObjectiveTitle(title, transcript),
          description: '',
          priority: 'medium'
        }
      });
    }
  }
  return output.slice(0, 10);
}
function pickActions(actions: unknown): Action[] {
  if (!Array.isArray(actions)) return [];
  const allowed = new Set([
    'navigate', 'create_project', 'update_project', 'delete_project',
    'create_objective', 'update_objective', 'toggle_objective_done', 'delete_objective',
    'add_progress', 'delete_progress',
    'add_daily', 'update_daily', 'delete_daily',
    'report_view',
    'open_settings', 'sync_supabase', 'verify_supabase', 'logout'
  ]);
  const out: Action[] = [];
  for (const item of actions.slice(0, 10)) {
    if (!item || typeof item !== 'object') continue;
    const type = String((item as Record<string, unknown>).type || '').trim();
    if (!allowed.has(type)) continue;
    const payload = (item as Record<string, unknown>).payload;
    out.push({
      type,
      payload: payload && typeof payload === 'object' ? payload as Record<string, unknown> : {}
    });
  }
  return out;
}

function fallbackPlan(transcript: string, context: Context): Plan {
  const n = normalize(transcript);
  const actions: Action[] = [];
  const bundle = parseUnifiedProjectBundle(transcript);

  if (!bundle) {
    if (n.includes('dashboard')) actions.push({ type: 'navigate', payload: { view: 'dashboard' } });
    if (n.includes('proyecto') && (n.includes('abrir') || n.includes('ver'))) actions.push({ type: 'navigate', payload: { view: 'projects' } });
    if (n.includes('trabajo diario') || n.includes('diario')) actions.push({ type: 'navigate', payload: { view: 'daily' } });
    if (n.includes('reporte')) actions.push({ type: 'navigate', payload: { view: 'reports' } });
    if (n.includes('configuracion') || n.includes('ajustes')) actions.push({ type: 'open_settings', payload: {} });
    if (n.includes('sincroniza') || n.includes('sincronizar') || n.includes('sync')) actions.push({ type: 'sync_supabase', payload: {} });
    if (n.includes('verifica nube') || n.includes('verificar nube')) actions.push({ type: 'verify_supabase', payload: {} });
    if (n.includes('cerrar sesion')) actions.push({ type: 'logout', payload: {} });
  }

  if (bundle) {
    actions.push({
      type: 'create_project',
      payload: {
        name: bundle.title,
        description: bundle.description || transcript,
        status: 'active'
      }
    });
    for (const obj of bundle.objectives.slice(0, 10)) {
      actions.push({
        type: 'create_objective',
        payload: {
          project_name: bundle.title,
          title: obj,
          description: '',
          priority: 'medium'
        }
      });
    }
  } else if (n.includes('crear proyecto') || n.includes('crea proyecto') || (n.includes('crea') && n.includes('proyecto')) || n.includes('nuevo proyecto')) {
    const projectTitle = cleanProjectName(transcript, transcript);
    actions.push({
      type: 'create_project',
      payload: {
        name: projectTitle,
        description: transcript,
        status: 'active'
      }
    });
    if (n.includes('objetivo')) {
      const objectiveTitle = objectiveHintFromTranscript(transcript);
      if (objectiveTitle) {
        actions.push({
          type: 'create_objective',
          payload: {
            project_name: projectTitle,
            title: objectiveTitle,
            description: '',
            priority: 'medium'
          }
        });
      }
    }
  } else {
    const defaultTitle = transcript.split(/[.!?\n]/)[0].slice(0, 120).trim() || 'Registro diario';
    actions.push({
      type: 'add_daily',
      payload: {
        title: defaultTitle,
        description: transcript,
        date: context.today || new Date().toISOString().split('T')[0],
        category: n.includes('soporte') ? 'otro' : 'desarrollo'
      }
    });
  }

  return {
    summary: `Comando detectado: ${transcript}`,
    actions
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as Payload;
    const transcript = String(body?.transcript || '').trim();
    if (!transcript) return json({ error: 'transcript requerido' }, 400);

    const context = (body?.context || {}) as Context;
    const projects = Array.isArray(context.projects) ? context.projects.slice(0, 80) : [];
    const objectives = Array.isArray(context.objectives) ? context.objectives.slice(0, 280) : [];
    const progress = Array.isArray(context.progress) ? context.progress.slice(0, 200) : [];
    const daily = Array.isArray(context.daily) ? context.daily.slice(0, 200) : [];

    const apiKey = String(body?.ollama_api_key || Deno.env.get('OLLAMA_API_KEY') || '').trim();
    if (!apiKey) {
      return json({ plan: fallbackPlan(transcript, context), provider: 'fallback' });
    }

    const model = String(body?.ollama_model || Deno.env.get('OLLAMA_MODEL') || 'gpt-oss:120b').trim();

    const prompt = {
      transcript,
      context: {
        currentView: context.currentView || 'dashboard',
        activeProjectId: context.activeProjectId || null,
        today: context.today || new Date().toISOString().split('T')[0],
        projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status || 'active' })),
        objectives: objectives.map((o) => ({ id: o.id, title: o.title, projectId: o.projectId, done: !!o.done, progress: Number(o.progress || 0) })),
        progress: progress.map((e) => ({
          id: e.id,
          description: String(e.description || '').slice(0, 100),
          projectId: e.projectId,
          objectiveId: e.objectiveId || null,
          percent: Number(e.percent || 0),
          hours: Number(e.hours || 0),
          date: e.date
        })),
        daily: daily.map((e) => ({
          id: e.id,
          title: String(e.title || '').slice(0, 100),
          projectId: e.projectId || null,
          category: e.category || 'otro',
          date: e.date
        }))
      }
    };

    const completion = await fetch('https://ollama.com/api/chat', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        format: 'json',
        messages: [
          {
            role: 'system',
            content:
              'Eres un planificador de comandos de voz para ProjectFlow. Devuelve SOLO JSON valido con esta forma exacta: {"summary":"texto","actions":[{"type":"navigate|create_project|update_project|delete_project|create_objective|update_objective|toggle_objective_done|delete_objective|add_progress|delete_progress|add_daily|update_daily|delete_daily|report_view|open_settings|sync_supabase|verify_supabase|logout","payload":{...}}]}. Usa IDs existentes cuando sea posible. Si no sabes un ID, usa project_name o objective_title en payload para que cliente resuelva. Para add_daily incluye title y description. Para add_progress incluye description, percent (0-100) y hours. Si el usuario manda campos tipo \"titulo: ... descripcion: ... objetivos: ...\", crea un proyecto con ese titulo/descripcion y una accion create_objective por cada objetivo. No escribas markdown, no agregues texto fuera del JSON.'
          },
          {
            role: 'user',
            content: JSON.stringify(prompt)
          }
        ]
      })
    });

    if (!completion.ok) {
      const errText = await completion.text();
      return json({ plan: fallbackPlan(transcript, context), provider: 'fallback', reason: `ollama_error:${errText}` });
    }

    const parsed = await completion.json();
    const content = String(parsed?.message?.content || '{}').trim();

    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(content);
    } catch {
      return json({ plan: fallbackPlan(transcript, context), provider: 'fallback', reason: 'invalid_json' });
    }

    const actions = enrichActionsFromTranscript(sanitizeActions(pickActions(raw.actions), transcript), transcript);
    if (!actions.length) {
      return json({ plan: fallbackPlan(transcript, context), provider: 'fallback', reason: 'empty_actions' });
    }

    const summary = String(raw.summary || `Plan para: ${transcript}`).slice(0, 300);
    return json({
      plan: { summary, actions },
      provider: 'ollama',
      model
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 500);
  }
});


