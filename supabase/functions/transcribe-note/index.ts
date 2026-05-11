import { corsHeaders } from '../_shared/cors.ts';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get('OPENAI_API_KEY');
    if (!apiKey) return json({ error: 'Falta OPENAI_API_KEY en secretos de Supabase' }, 500);

    const contentType = req.headers.get('content-type') || '';
    let file: File;

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const incoming = form.get('audio');
      if (!(incoming instanceof File)) return json({ error: 'Campo audio faltante' }, 400);
      file = incoming;
    } else {
      const blob = await req.blob();
      if (!blob || !blob.size) return json({ error: 'Audio vacio' }, 400);
      file = new File([blob], `audio-${Date.now()}.webm`, { type: blob.type || 'audio/webm' });
    }

    if (file.size > 12 * 1024 * 1024) return json({ error: 'Audio demasiado grande (max 12MB)' }, 413);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('model', 'gpt-4o-mini-transcribe');
    formData.append('language', 'es');

    const tr = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData
    });

    if (!tr.ok) {
      const errText = await tr.text();
      return json({ error: `OpenAI transcription error: ${errText}` }, 502);
    }

    const out = await tr.json();
    const text = String(out?.text || '').trim();
    if (!text) return json({ error: 'No se pudo transcribir el audio' }, 422);

    return json({ text, model: 'gpt-4o-mini-transcribe' });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'Error desconocido' }, 500);
  }
});
