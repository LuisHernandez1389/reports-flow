import { corsHeaders } from '../_shared/cors.ts';

type Payload = {
  title?: string;
  kind?: 'project' | 'objective' | 'daily' | string;
  ollama_api_key?: string;
  ollama_model?: string;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function fallback(title: string, kind: string) {
  const t = title.trim();
  if (!t) return '';
  if (kind === 'project') return `Proyecto enfocado en ${t.toLowerCase()}, con alcance claro, entregables definidos y seguimiento continuo de avances.`;
  if (kind === 'objective') return `Objetivo orientado a ${t.toLowerCase()}, con criterios medibles para validar cumplimiento y progreso.`;
  if (kind === 'daily') return `Actividad relacionada con ${t.toLowerCase()}, detallando acciones ejecutadas, resultado obtenido y próximos pasos.`;
  return `Descripcion para ${t.toLowerCase()}.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as Payload;
    const title = String(body?.title || '').trim().slice(0, 180);
    const kind = String(body?.kind || 'project').trim().toLowerCase();
    if (!title) return json({ error: 'title requerido' }, 400);

    const apiKey = String(body?.ollama_api_key || Deno.env.get('OLLAMA_API_KEY') || '').trim();
    if (!apiKey) {
      return json({ description: fallback(title, kind), provider: 'fallback' });
    }

    const model = String(body?.ollama_model || Deno.env.get('OLLAMA_MODEL') || 'gpt-oss:120b').trim();
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
            content: 'Genera SOLO JSON valido con forma {"description":"texto"}. Escribe una descripcion clara, profesional y breve (max 2 oraciones), en espanol.'
          },
          {
            role: 'user',
            content: JSON.stringify({ title, kind })
          }
        ]
      })
    });

    if (!completion.ok) {
      return json({ description: fallback(title, kind), provider: 'fallback' });
    }

    const parsed = await completion.json();
    const content = String(parsed?.message?.content || '{}').trim();
    let raw: Record<string, unknown> = {};
    try {
      raw = JSON.parse(content);
    } catch {
      return json({ description: fallback(title, kind), provider: 'fallback' });
    }

    const description = String(raw?.description || '').trim();
    return json({
      description: (description || fallback(title, kind)).slice(0, 2000),
      provider: 'ollama',
      model
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 500);
  }
});

