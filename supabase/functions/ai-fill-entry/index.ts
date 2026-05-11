import { corsHeaders } from '../_shared/cors.ts';

type Project = { id: string; name: string; status?: string };
type Objective = { id: string; title: string; projectId: string; done?: boolean; progress?: number };

type Payload = {
  transcript?: string;
  date?: string;
  projects?: Project[];
  objectives?: Objective[];
  ollama_api_key?: string;
  ollama_model?: string;
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

function categoryOf(v: unknown) {
  const n = normalize(v);
  if (['proyecto', 'desarrollo', 'dev', 'codigo', 'programacion'].some((k) => n.includes(k))) return 'desarrollo';
  if (['diseno', 'diseño', 'ux', 'ui'].some((k) => n.includes(k))) return 'diseño';
  if (['reunion', 'reunión', 'meeting', 'junta'].some((k) => n.includes(k))) return 'reunión';
  if (['investigacion', 'investigación', 'analisis', 'research'].some((k) => n.includes(k))) return 'investigación';
  if (['soporte', 'imprevisto', 'incidente', 'otro'].some((k) => n.includes(k))) return 'otro';
  return 'otro';
}

function clampHours(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const c = Math.min(24, Math.max(0.5, Math.round(n * 2) / 2));
  return c;
}

function clampPercent(v: unknown) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n)));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as Payload;
    const transcript = String(body?.transcript || '').trim();
    if (!transcript) return json({ error: 'transcript requerido' }, 400);

    const projects = Array.isArray(body?.projects) ? body.projects.slice(0, 60) : [];
    const objectives = Array.isArray(body?.objectives) ? body.objectives.slice(0, 250) : [];
    const date = String(body?.date || '').slice(0, 10);

    const apiKey = String(body?.ollama_api_key || Deno.env.get('OLLAMA_API_KEY') || '').trim();
    if (!apiKey) return json({ error: 'Falta OLLAMA_API_KEY en secretos o body' }, 500);

    const model = String(body?.ollama_model || Deno.env.get('OLLAMA_MODEL') || 'gpt-oss:120b').trim();

    const prompt = {
      transcript,
      date,
      projects: projects.map((p) => ({ id: p.id, name: p.name, status: p.status || 'active' })),
      objectives: objectives.map((o) => ({ id: o.id, title: o.title, projectId: o.projectId, done: !!o.done, progress: Number(o.progress || 0) }))
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
              'Convierte una nota de voz de trabajo en JSON estructurado. Devuelve SOLO JSON con esta forma exacta: {"title":"","description":"","category":"desarrollo|diseño|reunión|investigación|otro","project_id":string|null,"project_name":string|null,"objective_id":string|null,"suggested_percent":number|null,"hours":number|null,"date":"YYYY-MM-DD"|null,"confidence":number}. Si el texto es soporte/imprevisto, project_id y objective_id deben ser null. No inventes IDs.'
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
      return json({ error: `Ollama error: ${errText}` }, 502);
    }

    const parsed = await completion.json();
    const content = String(parsed?.message?.content || '{}');

    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(content);
    } catch {
      return json({ error: 'Ollama no devolvio JSON valido' }, 502);
    }

    const knownProject = raw.project_id && projects.find((p) => p.id === String(raw.project_id));
    const projectName = normalize(raw.project_name);
    const projectByName = !knownProject && projectName
      ? projects.find((p) => normalize(p.name) === projectName || normalize(p.name).includes(projectName))
      : null;

    const resolvedProjectId = knownProject?.id || projectByName?.id || null;

    const objectiveId = String(raw.objective_id || '').trim();
    const resolvedObjective = objectiveId
      ? objectives.find((o) => o.id === objectiveId && (!resolvedProjectId || o.projectId === resolvedProjectId))
      : null;

    const fallbackTitle = transcript.split(/[.!?\n]/)[0].slice(0, 80).trim() || 'Registro diario';

    const suggestion = {
      title: String(raw.title || fallbackTitle).slice(0, 120),
      description: String(raw.description || transcript).slice(0, 2000),
      category: categoryOf(raw.category),
      project_id: resolvedProjectId,
      project_name: resolvedProjectId ? (projects.find((p) => p.id === resolvedProjectId)?.name || null) : null,
      objective_id: resolvedObjective?.id || null,
      suggested_percent: resolvedObjective ? clampPercent(raw.suggested_percent) : null,
      hours: clampHours(raw.hours),
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.date || '')) ? String(raw.date) : (date || null),
      confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0.7))
    };

    return json({ suggestion, provider: 'ollama', model });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 500);
  }
});
