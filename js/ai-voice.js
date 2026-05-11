/* ai-voice.js - Voice dictation + AI autofill for daily entries */
'use strict';

const AIVoice = (() => {
  let recorder = null;
  let mediaStream = null;
  let chunks = [];
  let stopTimer = null;
  let isRecording = false;
  let recognition = null;
  let autoSaving = false;

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

  function setStatus(msg, isError = false) {
    const el = byId('dailyVoiceStatus');
    if (!el) return;
    el.textContent = msg;
    el.style.color = isError ? 'var(--red)' : 'var(--text-muted)';
  }

  function setRecordingUi(recording) {
    const btn = byId('dailyVoiceBtn');
    if (!btn) return;
    btn.classList.toggle('recording', !!recording);
    btn.innerHTML = recording
      ? '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Detener grabacion'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="9" y="2.5" width="6" height="11" rx="3"/><path d="M5 10.5a7 7 0 0014 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg> Dictar con voz';
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
      setStatus('Escuchando... habla ahora');
    };

    recognition.onerror = (ev) => {
      isRecording = false;
      setRecordingUi(false);
      const msg = ev?.error ? `Error de voz: ${ev.error}` : 'Error de voz';
      setStatus(msg, true);
    };

    recognition.onend = () => {
      isRecording = false;
      setRecordingUi(false);
    };

    recognition.onresult = async (ev) => {
      const text = String(ev?.results?.[0]?.[0]?.transcript || '').trim();
      if (!text) {
        setStatus('No se detecto texto', true);
        return;
      }
      setStatus('Analizando texto con IA...');
      await suggestFromTranscript(text);
    };

    return true;
  }

  async function startRecording() {
    if (recognition) {
      try {
        recognition.start();
      } catch (_err) {
        setStatus('No se pudo iniciar reconocimiento', true);
      }
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      UI.toast('Tu navegador no soporta grabacion de audio', 'error');
      return;
    }

    try {
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
        const finalMime = recorder?.mimeType || 'audio/webm';
        const audioBlob = new Blob(chunks, { type: finalMime });
        cleanupMedia();
        isRecording = false;
        setRecordingUi(false);

        if (!audioBlob.size) {
          setStatus('No se capturo audio', true);
          return;
        }

        setStatus('Transcribiendo audio...');
        await transcribeAndSuggest(audioBlob);
      };

      recorder.start();
      isRecording = true;
      setRecordingUi(true);
      setStatus('Grabando... habla ahora');

      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => {
        if (isRecording) stopRecording();
      }, 60000);
    } catch (_err) {
      cleanupMedia();
      isRecording = false;
      setRecordingUi(false);
      setStatus('No se pudo iniciar el microfono', true);
      UI.toast('Permite acceso al microfono para usar dictado', 'error');
    }
  }

  function stopRecording() {
    if (recognition) {
      try { recognition.stop(); } catch (_err) {}
      return;
    }

    if (!recorder || recorder.state === 'inactive') return;
    clearTimeout(stopTimer);
    setStatus('Procesando audio...');
    recorder.stop();
  }

  function cleanupMedia() {
    clearTimeout(stopTimer);
    stopTimer = null;
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    recorder = null;
  }

  async function transcribeAndSuggest(audioBlob) {
    try {
      const client = window.SupabaseStorage?.getClient?.();
      if (!client) throw new Error('Supabase no configurado');

      let transcript = '';
      let tRes = await client.functions.invoke('transcribe-note', { body: audioBlob });
      if (tRes?.error || !tRes?.data?.text) {
        const form = new FormData();
        form.append('audio', audioBlob, 'nota.webm');
        tRes = await client.functions.invoke('transcribe-note', { body: form });
      }
      if (tRes?.error) throw tRes.error;

      transcript = String(tRes?.data?.text || '').trim();
      if (!transcript) throw new Error('No se obtuvo texto del audio');

      await suggestFromTranscript(transcript);
    } catch (err) {
      setStatus('Error en dictado IA', true);
      UI.toast(`Error de voz: ${err?.message || 'fallo de procesamiento'}`, 'error');
    }
  }

  async function suggestFromTranscript(transcript) {
    try {
      if (autoSaving) return;
      const client = window.SupabaseStorage?.getClient?.();
      if (!client) throw new Error('Supabase no configurado');

      const projects = DB.projects.getAll().map((p) => ({ id: p.id, name: p.name, status: p.status || 'active' }));
      const objectives = DB.objectives.getAll().map((o) => ({
        id: o.id,
        title: o.title,
        projectId: o.projectId,
        done: !!o.done,
        progress: Number(o.progress || 0)
      }));

      const aiCfg = window.SupabaseStorage?.getAIConfig?.() || {};
      const aiRes = await client.functions.invoke('ai-fill-entry', {
        body: {
          transcript,
          date: byId('dailyDate')?.value || new Date().toISOString().split('T')[0],
          projects,
          objectives,
          ollama_api_key: aiCfg.ollamaKey || undefined,
          ollama_model: aiCfg.ollamaModel || undefined
        }
      });

      if (aiRes?.error) throw aiRes.error;
      const suggestion = aiRes?.data?.suggestion || aiRes?.data || {};
      const resolved = applySuggestion(suggestion, transcript, projects, objectives);
      const ok = await UI.confirm(buildConfirmMessage(resolved), {
        title: 'Confirmar registro IA',
        confirmText: 'Confirmar y guardar',
        cancelText: 'Cancelar'
      });
      if (!ok) {
        setStatus('Puedes ajustar los campos manualmente');
        return;
      }

      autoSaving = true;
      setStatus('Guardando registro...');
      await submitDailyForm();
      setStatus('Registro guardado correctamente');
      UI.toast('Entrada guardada con IA', 'success');
    } catch (err) {
      setStatus('Error en analisis IA', true);
      UI.toast(`Error IA: ${err?.message || 'fallo de procesamiento'}`, 'error');
    } finally {
      autoSaving = false;
    }
  }

  function applySuggestion(suggestion, transcript, projects, objectives) {
    const titleEl = byId('dailyTitle');
    const descEl = byId('dailyDescription');
    const hoursEl = byId('dailyHours');
    const dateEl = byId('dailyDate');
    const projectEl = byId('dailyProject');

    if (titleEl && suggestion.title) titleEl.value = String(suggestion.title).trim();
    if (descEl) {
      const aiDesc = String(suggestion.description || '').trim();
      descEl.value = aiDesc || transcript;
    }

    const hoursNum = Number(suggestion.hours);
    if (hoursEl && Number.isFinite(hoursNum) && hoursNum > 0) hoursEl.value = String(hoursNum);

    if (dateEl && suggestion.date) {
      const d = String(suggestion.date).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(d)) dateEl.value = d;
    }

    if (projectEl) {
      const sid = String(suggestion.project_id || '').trim();
      const sname = norm(suggestion.project_name || '');
      let selected = '';

      if (sid && projects.some((p) => p.id === sid)) {
        selected = sid;
      } else if (sname) {
        const match = projects.find((p) => norm(p.name) === sname || norm(p.name).includes(sname));
        if (match) selected = match.id;
      }
      projectEl.value = selected;
    }

    selectDailyCategory(suggestion.category);

    const objectiveId = String(suggestion.objective_id || '').trim();
    const objective = objectiveId ? objectives.find((o) => o.id === objectiveId) : null;
    const pct = Number(suggestion.suggested_percent);
    if (objective) {
      const pctLabel = Number.isFinite(pct) && pct >= 0 ? ` (${pct}%)` : '';
      UI.toast(`IA sugiere avance para objetivo: ${objective.title}${pctLabel}`, 'default');
    }

    return {
      title: (titleEl?.value || '').trim(),
      description: (descEl?.value || '').trim(),
      date: (dateEl?.value || '').trim(),
      hours: (hoursEl?.value || '').trim(),
      category: String(suggestion.category || ''),
      projectName: projectEl?.selectedOptions?.[0]?.textContent || 'Soporte / sin proyecto',
      objectiveName: objective?.title || '',
      suggestedPercent: Number.isFinite(pct) ? pct : null
    };
  }

  function buildConfirmMessage(v) {
    const lines = [
      `Titulo: ${v.title || 'Sin titulo'}`,
      `Descripcion: ${v.description || 'Sin descripcion'}`,
      `Fecha: ${v.date || 'Hoy'}`,
      `Horas: ${v.hours || 'No especificadas'}`,
      `Categoria: ${v.category || 'otro'}`,
      `Proyecto: ${v.projectName || 'Soporte / sin proyecto'}`
    ];
    if (v.objectiveName) {
      lines.push(`Objetivo sugerido: ${v.objectiveName}${v.suggestedPercent != null ? ` (${v.suggestedPercent}%)` : ''}`);
    }
    lines.push('');
    lines.push('Se guardara automaticamente al confirmar.');
    return lines.join('\n');
  }

  function submitDailyForm() {
    const form = byId('dailyForm');
    if (!form) return Promise.reject(new Error('Formulario diario no disponible'));

    return new Promise((resolve, reject) => {
      let settled = false;
      const onSaved = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };
      const onTimeout = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error('No se pudo confirmar el guardado'));
      };
      const cleanup = () => {
        clearTimeout(timer);
        document.removeEventListener('daily:entry-saved', onSaved);
      };

      document.addEventListener('daily:entry-saved', onSaved, { once: true });
      const timer = setTimeout(onTimeout, 12000);
      form.requestSubmit();
    });
  }

  function selectDailyCategory(rawCategory) {
    const target = norm(rawCategory);
    const radios = Array.from(document.querySelectorAll('input[name="dailyCategory"]'));
    if (!radios.length) return;

    const aliases = {
      desarrollo: ['desarrollo', 'dev', 'codigo', 'programacion', 'proyecto'],
      diseno: ['diseno', 'diseño', 'ux', 'ui'],
      reunion: ['reunion', 'reunión', 'meeting', 'junta'],
      investigacion: ['investigacion', 'investigación', 'analisis', 'research'],
      otro: ['otro', 'soporte', 'imprevisto', 'incidente']
    };

    const categoryKey = Object.keys(aliases).find((k) => aliases[k].some((a) => target.includes(norm(a)))) || 'otro';

    const match = radios.find((r) => {
      const rv = norm(r.value);
      if (categoryKey === 'desarrollo') return rv.includes('desarrollo');
      if (categoryKey === 'diseno') return rv.includes('diseno');
      if (categoryKey === 'reunion') return rv.includes('reunion');
      if (categoryKey === 'investigacion') return rv.includes('investigacion');
      return rv.includes('otro');
    });

    (match || radios[radios.length - 1]).checked = true;
  }

  function init() {
    const btn = byId('dailyVoiceBtn');
    if (!btn) return;

    initSpeechRecognition();
    if (recognition) setStatus('Listo para dictado');
    else setStatus('Sin reconocimiento nativo. Se usara audio por servidor.');

    btn.addEventListener('click', () => {
      if (isRecording) stopRecording();
      else startRecording();
    });
  }

  return { init };
})();

if (typeof window !== 'undefined') {
  window.AIVoice = AIVoice;
}
