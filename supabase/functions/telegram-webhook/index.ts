import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};

const BOT_TOKEN = Deno.env.get('TELEGRAM_BOT_TOKEN') || '8625969536:AAFp7oWoZUCS7lKtbTPN0JL-SJ-IiUgRWbk';
const ALLOWED_CHAT_ID = Deno.env.get('TELEGRAM_ALLOWED_CHAT_ID') || '7499462206';
const OLLAMA_API_KEY = Deno.env.get('OLLAMA_API_KEY') || '';
const OLLAMA_MODEL = Deno.env.get('OLLAMA_MODEL') || 'gpt-oss:120b';
const UPLOAD_BUCKET = Deno.env.get('TELEGRAM_UPLOAD_BUCKET') || 'projectflow-uploads';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

type Project = { id: string; name: string; status?: string };
type Objective = { id: string; title: string; project_id: string; done?: boolean; progress?: number };
type ProgressEntry = { id: string; description?: string; project_id?: string; objective_id?: string | null; percent?: number; hours?: number; date?: string };
type DailyEntry = { id: string; title?: string; project_id?: string | null; category?: string; date?: string };

type VoicePlan = {
  summary: string;
  actions: { type: string; payload?: Record<string, unknown> }[];
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function norm(v: unknown) {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function short(v: unknown, max = 120) {
  return String(v || '').trim().slice(0, max);
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
  return short(s || 'Nuevo proyecto', 140);
}

function uid() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function tgApi(method: string, payload?: Record<string, unknown>) {
  const url = `https://api.telegram.org/bot${BOT_TOKEN}/${method}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok === false) {
    throw new Error(`Telegram API ${method} fallo`);
  }
  return data;
}

async function sendMessage(chatId: string, text: string) {
  const msg = String(text || '');
  if (msg.length <= 3900) {
    await tgApi('sendMessage', { chat_id: chatId, text: msg, disable_web_page_preview: true });
    return;
  }
  const chunks = [];
  for (let i = 0; i < msg.length; i += 3900) chunks.push(msg.slice(i, i + 3900));
  for (const part of chunks) {
    // eslint-disable-next-line no-await-in-loop
    await tgApi('sendMessage', { chat_id: chatId, text: part, disable_web_page_preview: true });
  }
}

async function transcribeTelegramVoice(fileId: string) {
  const info = await tgApi('getFile', { file_id: fileId });
  const filePath = info?.result?.file_path;
  if (!filePath) throw new Error('No se pudo resolver el audio de Telegram');

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const audioRes = await fetch(fileUrl);
  if (!audioRes.ok) throw new Error('No se pudo descargar el audio');
  const audioBlob = await audioRes.blob();

  const tr = await fetch(`${SUPABASE_URL}/functions/v1/transcribe-note`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': audioBlob.type || 'audio/ogg'
    },
    body: audioBlob
  });
  if (!tr.ok) {
    let detail = '';
    try {
      const e = await tr.json();
      detail = String(e?.error || e?.message || '');
    } catch (_) {}
    throw new Error(detail ? `No se pudo transcribir la nota de voz: ${detail}` : 'No se pudo transcribir la nota de voz');
  }
  const out = await tr.json();
  const text = String(out?.text || out?.data?.text || '').trim();
  if (!text) throw new Error('Transcripcion vacia');
  return text;
}

async function downloadTelegramFile(fileId: string) {
  const info = await tgApi('getFile', { file_id: fileId });
  const filePath = String(info?.result?.file_path || '');
  if (!filePath) throw new Error('No se pudo resolver archivo de Telegram');

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const fileRes = await fetch(fileUrl);
  if (!fileRes.ok) throw new Error('No se pudo descargar archivo de Telegram');
  const blob = await fileRes.blob();
  return {
    blob,
    filePath,
    ext: filePath.includes('.') ? filePath.split('.').pop() || 'bin' : 'bin'
  };
}

async function uploadTelegramImage(
  admin: ReturnType<typeof createClient>,
  fileId: string,
  folder: string
) {
  const f = await downloadTelegramFile(fileId);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${f.ext}`;
  const contentType = f.blob.type || 'image/jpeg';
  const { error } = await admin.storage.from(UPLOAD_BUCKET).upload(path, f.blob, {
    contentType,
    upsert: false,
    cacheControl: '3600'
  });
  if (error) throw new Error(`No se pudo subir imagen a Storage: ${error.message}`);
  const pub = admin.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
  return pub?.data?.publicUrl || path;
}

async function loadContext(admin: ReturnType<typeof createClient>) {
  const [p, o, g, d] = await Promise.all([
    admin.from('projects').select('id,name,status').limit(200),
    admin.from('objectives').select('id,title,project_id,done,progress').limit(400),
    admin.from('progress_entries').select('id,description,project_id,objective_id,percent,hours,date').order('created_at', { ascending: false }).limit(200),
    admin.from('daily_entries').select('id,title,project_id,category,date').order('created_at', { ascending: false }).limit(200)
  ]);
  if (p.error) throw p.error;
  if (o.error) throw o.error;
  if (g.error) throw g.error;
  if (d.error) throw d.error;

  return {
    today: new Date().toISOString().slice(0, 10),
    projects: (p.data || []) as Project[],
    objectives: (o.data || []) as Objective[],
    progress: (g.data || []) as ProgressEntry[],
    daily: (d.data || []) as DailyEntry[]
  };
}

async function planFromAI(transcript: string, context: Awaited<ReturnType<typeof loadContext>>): Promise<VoicePlan> {
  const url = `${SUPABASE_URL}/functions/v1/ai-voice-command`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    },
    body: JSON.stringify({
      transcript,
      context: {
        currentView: 'telegram',
        activeProjectId: null,
        today: context.today,
        projects: context.projects.map((x) => ({ id: x.id, name: x.name, status: x.status || 'active' })),
        objectives: context.objectives.map((x) => ({ id: x.id, title: x.title, projectId: x.project_id, done: !!x.done, progress: Number(x.progress || 0) })),
        progress: context.progress.map((x) => ({ id: x.id, description: x.description || '', projectId: x.project_id || '', objectiveId: x.objective_id || null, percent: Number(x.percent || 0), hours: Number(x.hours || 0), date: x.date || '' })),
        daily: context.daily.map((x) => ({ id: x.id, title: x.title || '', projectId: x.project_id || null, category: x.category || 'otro', date: x.date || '' }))
      },
      ollama_api_key: OLLAMA_API_KEY || undefined,
      ollama_model: OLLAMA_MODEL
    })
  });
  if (!res.ok) throw new Error('No se pudo obtener plan IA');
  const data = await res.json();
  const plan = data?.plan || {};
  const actions = Array.isArray(plan.actions) ? plan.actions : [];
  return {
    summary: String(plan.summary || transcript).slice(0, 300),
    actions: actions.slice(0, 10)
  };
}

function findProject(projects: Project[], ref: unknown) {
  const token = String(ref || '').trim();
  if (!token) return null;
  const byId = projects.find((p) => p.id === token);
  if (byId) return byId;
  const n = norm(token);
  return projects.find((p) => norm(p.name) === n || norm(p.name).includes(n)) || null;
}

function findObjective(objectives: Objective[], ref: unknown, projectId?: string | null) {
  const token = String(ref || '').trim();
  if (!token) return null;
  const list = projectId ? objectives.filter((o) => o.project_id === projectId) : objectives;
  const byId = list.find((o) => o.id === token);
  if (byId) return byId;
  const n = norm(token);
  return list.find((o) => norm(o.title) === n || norm(o.title).includes(n)) || null;
}

function findDaily(daily: DailyEntry[], ref: unknown) {
  const token = String(ref || '').trim();
  if (!token) return null;
  const byId = daily.find((d) => d.id === token);
  if (byId) return byId;
  const n = norm(token);
  return daily.find((d) => norm(d.title || '').includes(n)) || null;
}

function findProgress(progress: ProgressEntry[], ref: unknown, objectiveId?: string | null, projectId?: string | null) {
  const token = String(ref || '').trim();
  if (!token) return null;
  const list = progress.filter((p) => (!objectiveId || p.objective_id === objectiveId) && (!projectId || p.project_id === projectId));
  const byId = list.find((d) => d.id === token);
  if (byId) return byId;
  const n = norm(token);
  return list.find((d) => norm(d.description || '').includes(n)) || null;
}

function toCategory(raw: unknown) {
  const n = norm(raw);
  if (n.includes('desarrollo') || n === 'dev') return 'desarrollo';
  if (n.includes('diseno') || n.includes('dise')) return 'diseno';
  if (n.includes('reunion') || n.includes('meeting') || n.includes('junta')) return 'reunion';
  if (n.includes('investig')) return 'investigacion';
  return 'otro';
}

function safeDate(v: unknown) {
  const s = String(v || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

async function executeActions(
  admin: ReturnType<typeof createClient>,
  plan: VoicePlan,
  context: Awaited<ReturnType<typeof loadContext>>,
  imageRef: string | null
) {
  const done: string[] = [];

  for (const action of plan.actions) {
    const type = String(action?.type || '');
    const payload = (action?.payload || {}) as Record<string, unknown>;

    if (type === 'create_project') {
      const name = cleanProjectName(payload.name, String(payload.description || ''));
      if (!name) continue;
      const row = {
        id: uid(),
        created_at: new Date().toISOString(),
        name,
        description: short(payload.description, 2000) || null,
        status: ['active', 'paused', 'completed'].includes(String(payload.status || '')) ? String(payload.status) : 'active',
        color: '#4F6EF7'
      };
      const { error } = await admin.from('projects').insert(row);
      if (!error) {
        done.push(`Proyecto creado: ${name}`);
        context.projects.unshift({ id: row.id, name: row.name, status: row.status });
      }
      continue;
    }

    if (type === 'update_project') {
      const p = findProject(context.projects, payload.project_id || payload.project_name || payload.project_ref);
      if (!p) continue;
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (payload.name) patch.name = cleanProjectName(payload.name);
      if (payload.description !== undefined) patch.description = short(payload.description, 2000);
      if (payload.status && ['active', 'paused', 'completed'].includes(String(payload.status))) patch.status = String(payload.status);
      const { error } = await admin.from('projects').update(patch).eq('id', p.id);
      if (!error) done.push(`Proyecto actualizado: ${p.name}`);
      continue;
    }

    if (type === 'delete_project') {
      const p = findProject(context.projects, payload.project_id || payload.project_name || payload.project_ref);
      if (!p) continue;
      const { error } = await admin.from('projects').delete().eq('id', p.id);
      if (!error) done.push(`Proyecto eliminado: ${p.name}`);
      continue;
    }

    if (type === 'create_objective') {
      const p = findProject(context.projects, payload.project_id || payload.project_name || payload.project_ref);
      const title = short(payload.title, 200);
      if (!p || !title) continue;
      const row = {
        id: uid(),
        created_at: new Date().toISOString(),
        project_id: p.id,
        title,
        description: short(payload.description, 2000) || null,
        priority: ['low', 'medium', 'high'].includes(String(payload.priority || '')) ? String(payload.priority) : 'medium',
        deadline: payload.deadline ? safeDate(payload.deadline) : null,
        progress: Number.isFinite(Number(payload.progress)) ? Math.max(0, Math.min(100, Number(payload.progress))) : 0,
        done: false
      };
      const { error } = await admin.from('objectives').insert(row);
      if (!error) {
        done.push(`Objetivo creado: ${title}`);
        context.objectives.unshift({
          id: row.id,
          title: row.title,
          project_id: row.project_id,
          done: !!row.done,
          progress: Number(row.progress || 0)
        });
      }
      continue;
    }

    if (type === 'update_objective' || type === 'toggle_objective_done' || type === 'delete_objective') {
      const p = findProject(context.projects, payload.project_id || payload.project_name || payload.project_ref);
      const o = findObjective(context.objectives, payload.objective_id || payload.objective_title || payload.objective_ref, p?.id || null);
      if (!o) continue;

      if (type === 'delete_objective') {
        const { error } = await admin.from('objectives').delete().eq('id', o.id);
        if (!error) done.push(`Objetivo eliminado: ${o.title}`);
        continue;
      }

      const patch: Record<string, unknown> = {};
      if (type === 'toggle_objective_done') {
        const nextDone = payload.done === undefined ? !o.done : !!payload.done;
        patch.done = nextDone;
        if (nextDone) patch.progress = 100;
      } else {
        if (payload.title) patch.title = short(payload.title, 200);
        if (payload.description !== undefined) patch.description = short(payload.description, 2000);
        if (payload.priority && ['low', 'medium', 'high'].includes(String(payload.priority))) patch.priority = String(payload.priority);
        if (payload.deadline) patch.deadline = safeDate(payload.deadline);
        if (payload.progress !== undefined && Number.isFinite(Number(payload.progress))) {
          const pv = Math.max(0, Math.min(100, Number(payload.progress)));
          patch.progress = pv;
          patch.done = pv >= 100;
        }
      }
      const { error } = await admin.from('objectives').update(patch).eq('id', o.id);
      if (!error) done.push(`Objetivo actualizado: ${o.title}`);
      continue;
    }

    if (type === 'add_progress') {
      const p = findProject(context.projects, payload.project_id || payload.project_name || payload.project_ref);
      const o = findObjective(context.objectives, payload.objective_id || payload.objective_title || payload.objective_ref, p?.id || null);
      const projectId = p?.id || o?.project_id || null;
      const description = short(payload.description, 2000);
      if (!projectId || !description) continue;
      const percent = Number.isFinite(Number(payload.percent)) ? Math.max(0, Math.min(100, Number(payload.percent))) : 0;
      const hours = Number.isFinite(Number(payload.hours)) ? Math.max(0.5, Math.min(24, Number(payload.hours))) : 1;
      const row = {
        id: uid(),
        created_at: new Date().toISOString(),
        project_id: projectId,
        objective_id: o?.id || null,
        description,
        percent,
        hours,
        date: safeDate(payload.date),
        file_ref: imageRef || null
      };
      const { error } = await admin.from('progress_entries').insert(row);
      if (!error) {
        done.push(`Avance registrado: ${description.slice(0, 70)}`);
        if (o?.id) {
          await admin.from('objectives').update({ progress: percent, done: percent >= 100 }).eq('id', o.id);
        }
      }
      continue;
    }

    if (type === 'delete_progress') {
      const p = findProject(context.projects, payload.project_id || payload.project_name || payload.project_ref);
      const o = findObjective(context.objectives, payload.objective_id || payload.objective_title || payload.objective_ref, p?.id || null);
      const g = findProgress(context.progress, payload.progress_id || payload.progress_ref || payload.description, o?.id || null, p?.id || null);
      if (!g) continue;
      const { error } = await admin.from('progress_entries').delete().eq('id', g.id);
      if (!error) done.push('Avance eliminado');
      continue;
    }

    if (type === 'add_daily') {
      const p = findProject(context.projects, payload.project_id || payload.project_name || payload.project_ref);
      const title = short(payload.title, 180);
      if (!title) continue;
      const row = {
        id: uid(),
        created_at: new Date().toISOString(),
        project_id: p?.id || null,
        title,
        description: short(payload.description, 2000) || null,
        date: safeDate(payload.date),
        hours: payload.hours == null || payload.hours === '' ? null : Math.max(0.5, Math.min(24, Number(payload.hours))),
        category: toCategory(payload.category),
        file_ref: imageRef || null
      };
      const { error } = await admin.from('daily_entries').insert(row);
      if (!error) done.push(`Trabajo diario registrado: ${title}`);
      continue;
    }

    if (type === 'update_daily') {
      const d = findDaily(context.daily, payload.entry_id || payload.entry_ref || payload.title);
      if (!d) continue;
      const p = payload.project_id || payload.project_name || payload.project_ref ? findProject(context.projects, payload.project_id || payload.project_name || payload.project_ref) : null;
      const patch: Record<string, unknown> = {};
      if (payload.title) patch.title = short(payload.title, 180);
      if (payload.description !== undefined) patch.description = short(payload.description, 2000);
      if (payload.date) patch.date = safeDate(payload.date);
      if (payload.hours !== undefined && payload.hours !== null && payload.hours !== '') patch.hours = Math.max(0.5, Math.min(24, Number(payload.hours)));
      if (payload.category) patch.category = toCategory(payload.category);
      if (p || payload.project_id === null) patch.project_id = p?.id || null;
      if (imageRef) patch.file_ref = imageRef;
      const { error } = await admin.from('daily_entries').update(patch).eq('id', d.id);
      if (!error) done.push(`Trabajo diario actualizado: ${d.title || d.id}`);
      continue;
    }

    if (type === 'delete_daily') {
      const d = findDaily(context.daily, payload.entry_id || payload.entry_ref || payload.title);
      if (!d) continue;
      const { error } = await admin.from('daily_entries').delete().eq('id', d.id);
      if (!error) done.push(`Trabajo diario eliminado: ${d.title || d.id}`);
      continue;
    }
  }

  return done;
}

function helpText() {
  return [
    'Comandos de ejemplo:',
    '- "crea proyecto sitio web nuevo"',
    '- "agrega objetivo al proyecto sitio web: terminar landing"',
    '- "registra avance 40% del objetivo landing con descripcion ..."',
    '- "registra trabajo diario soporte impresora 2 horas"',
    '- "editar proyecto sitio web a pausado"',
    '- "foto del avance login 60%" (en caption de una foto)',
    '- "soporte impresora 1 hora" (con foto adjunta)',
    '',
    'Tambien puedes mandar nota de voz y fotos.'
  ].join('\n');
}

Deno.serve(async (req: Request) => {
  let chatId = '';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: true, msg: 'telegram-webhook listo' });

  try {
    if (!BOT_TOKEN) return json({ error: 'TELEGRAM_BOT_TOKEN faltante' }, 500);
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'Supabase service role no configurado' }, 500);
    }

    const update = await req.json();
    const message = update?.message || update?.edited_message || null;
    if (!message) return json({ ok: true });

    chatId = String(message?.chat?.id || '');
    if (!chatId) return json({ ok: true });

    if (chatId !== String(ALLOWED_CHAT_ID)) {
      await sendMessage(chatId, 'Acceso no autorizado para este bot.');
      return json({ ok: true });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false }
    });

    const rawText = String(message?.text || '').trim();
    const rawCaption = String(message?.caption || '').trim();
    let transcript = rawText || rawCaption;
    let imageFileId = '';
    let imageRef: string | null = null;

    const photoArr = Array.isArray(message?.photo) ? message.photo : [];
    if (photoArr.length) {
      const biggest = photoArr[photoArr.length - 1];
      imageFileId = String(biggest?.file_id || '');
    } else if (message?.document?.file_id && String(message?.document?.mime_type || '').startsWith('image/')) {
      imageFileId = String(message.document.file_id);
    }

    if (!transcript && message?.voice?.file_id) {
      await sendMessage(chatId, 'Recibi tu voz. Transcribiendo...');
      transcript = await transcribeTelegramVoice(String(message.voice.file_id));
    }

    if (imageFileId) {
      await sendMessage(chatId, 'Recibi imagen. Subiendo a nube...');
      imageRef = await uploadTelegramImage(admin, imageFileId, 'telegram');
      if (!transcript) {
        transcript = 'registra trabajo diario con foto adjunta';
      }
    }

    if (!transcript) {
      await sendMessage(chatId, helpText());
      return json({ ok: true });
    }

    await sendMessage(chatId, `Entendido: "${short(transcript, 180)}"\nProcesando...`);

    const context = await loadContext(admin);
    const plan = await planFromAI(transcript, context);
    const done = await executeActions(admin, plan, context, imageRef);

    if (!done.length) {
      await sendMessage(chatId, `No pude ejecutar acciones con ese comando.\n\n${helpText()}`);
      return json({ ok: true });
    }

    const out = [
      `Resumen IA: ${plan.summary}`,
      '',
      'Hecho:',
      ...done.map((d, i) => `${i + 1}. ${d}`)
    ].join('\n');

    await sendMessage(chatId, out);
    return json({ ok: true, done });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    if (chatId) {
      try {
        await sendMessage(chatId, `Error procesando audio/comando: ${msg}`);
      } catch (_) {}
    }
    return json({ ok: true, error: msg });
  }
});
