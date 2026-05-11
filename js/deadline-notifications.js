/* deadline-notifications.js - objective delivery reminders */
'use strict';

const DeadlineNotifications = (() => {
  const CFG_KEY = 'pf_notif_cfg';
  const LOG_KEY = 'pf_notif_log';
  const CHECK_INTERVAL_MS = 30 * 60 * 1000;
  let timer = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function todayIso() {
    return new Date().toISOString().split('T')[0];
  }

  function parseJson(raw, fallback) {
    try {
      return JSON.parse(raw || '');
    } catch {
      return fallback;
    }
  }

  function getCfg() {
    const cfg = parseJson(localStorage.getItem(CFG_KEY), null);
    return { enabled: !!cfg?.enabled };
  }

  function setCfg(cfg) {
    localStorage.setItem(CFG_KEY, JSON.stringify({ enabled: !!cfg?.enabled }));
  }

  function getLog() {
    return parseJson(localStorage.getItem(LOG_KEY), {});
  }

  function setLog(log) {
    localStorage.setItem(LOG_KEY, JSON.stringify(log || {}));
  }

  function setSettingsStatus(text) {
    const el = byId('notifSettingsStatus');
    if (el) el.textContent = text;
  }

  function updateBadge() {
    const badge = byId('notifStatusBadge');
    const settingsStatus = byId('notifSettingsStatus');
    const writeStatus = (text) => {
      if (badge) badge.textContent = text;
      if (settingsStatus && !settingsStatus.textContent) settingsStatus.textContent = text;
    };

    if (!('Notification' in window)) {
      writeStatus('Notificaciones no soportadas');
      return;
    }

    const cfg = getCfg();
    if (!cfg.enabled) {
      writeStatus('Notificaciones desactivadas');
      return;
    }

    const p = Notification.permission;
    if (p === 'granted') writeStatus('Notificaciones activas');
    else if (p === 'denied') writeStatus('Notificaciones bloqueadas');
    else writeStatus('Permiso pendiente');
  }

  function daysUntil(dateStr) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(String(dateStr || '') + 'T00:00:00');
    due.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / 86400000);
  }

  function getPendingDeliveries() {
    const objectives = DB.objectives.getAll();
    return objectives
      .filter((o) => !o.done && o.deadline)
      .map((o) => {
        const project = DB.projects.getById(o.projectId);
        return {
          id: o.id,
          title: o.title,
          deadline: o.deadline,
          projectId: o.projectId,
          projectName: project?.name || 'Proyecto',
          days: daysUntil(o.deadline)
        };
      })
      .filter((o) => o.days <= 2)
      .sort((a, b) => a.days - b.days);
  }

  function composeNotification(item) {
    const prefix = item.days < 0
      ? `Atrasado ${Math.abs(item.days)} dia${Math.abs(item.days) !== 1 ? 's' : ''}`
      : item.days === 0
        ? 'Vence hoy'
        : item.days === 1
          ? 'Vence manana'
          : 'Vence pronto';

    return {
      title: `Entrega pendiente: ${item.title}`,
      body: `${prefix} - ${item.projectName} - Fecha limite ${item.deadline}`
    };
  }

  async function showNotification(item) {
    const msg = composeNotification(item);
    const data = { url: '/?view=projects', projectId: item.projectId };

    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 4500))
      ]);

      if (reg && reg.showNotification) {
        await reg.showNotification(msg.title, {
          body: msg.body,
          tag: `deadline-${item.id}`,
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          renotify: false,
          data
        });
        return;
      }
    }

    const n = new Notification(msg.title, {
      body: msg.body,
      icon: './icons/icon-192.png',
      tag: `deadline-${item.id}`
    });

    n.onclick = () => {
      window.focus();
      window.location.href = '/?view=projects';
      n.close();
    };
  }

  function canNotify() {
    return 'Notification' in window && Notification.permission === 'granted';
  }

  async function ensurePermission() {
    if (!('Notification' in window)) return 'unsupported';
    let permission = Notification.permission;
    if (permission !== 'granted') {
      permission = await Notification.requestPermission();
    }
    return permission;
  }

  async function runCheck() {
    const cfg = getCfg();
    if (!cfg.enabled || !canNotify()) return { checked: 0, sent: 0 };

    const list = getPendingDeliveries();
    if (!list.length) return { checked: 0, sent: 0 };

    const log = getLog();
    const today = todayIso();
    let sent = 0;

    for (const item of list) {
      const key = `${item.id}:${today}`;
      if (log[key]) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await showNotification(item);
        log[key] = true;
        sent += 1;
      } catch (_) {
        // ignore notification errors
      }
    }

    setLog(log);
    return { checked: list.length, sent };
  }

  function startLoop() {
    clearInterval(timer);
    timer = setInterval(() => {
      runCheck().catch(() => {});
    }, CHECK_INTERVAL_MS);
  }

  async function enableNotifications() {
    if (!('Notification' in window)) {
      UI.toast('Tu navegador no soporta notificaciones', 'error');
      return;
    }

    const permission = await ensurePermission();
    if (permission !== 'granted') {
      UI.toast('No se concedio permiso de notificaciones', 'error');
      updateBadge();
      return;
    }

    setCfg({ enabled: true });
    updateBadge();
    setSettingsStatus('Notificaciones activadas');
    UI.toast('Notificaciones activadas', 'success');
    await runCheck();
  }

  function disableNotifications() {
    setCfg({ enabled: false });
    updateBadge();
    setSettingsStatus('Notificaciones desactivadas');
    UI.toast('Notificaciones desactivadas');
  }

  async function testNotification() {
    const permission = await ensurePermission();
    if (permission !== 'granted') {
      UI.toast('No se concedio permiso de notificaciones', 'error');
      updateBadge();
      return false;
    }

    const now = Date.now();
    const title = 'Prueba de notificacion';
    const body = `Si ves esto, las notificaciones funcionan. ${new Date(now).toLocaleTimeString('es-MX')}`;
    const tag = `manual-test-${now}`;

    if ('serviceWorker' in navigator) {
      const reg = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((resolve) => setTimeout(() => resolve(null), 4500))
      ]);
      if (reg && reg.showNotification) {
        await reg.showNotification(title, {
          body,
          tag,
          icon: './icons/icon-192.png',
          badge: './icons/icon-192.png',
          renotify: true,
          requireInteraction: true,
          data: { url: '/?view=projects' }
        });
        UI.toast('Notificacion de prueba enviada', 'success');
        setSettingsStatus('Prueba enviada por Service Worker');
        return true;
      }
    }

    const n = new Notification(title, {
      body,
      icon: './icons/icon-192.png',
      tag,
      renotify: true,
      requireInteraction: true
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };

    UI.toast('Notificacion de prueba enviada', 'success');
    setSettingsStatus('Prueba enviada por Notification API');
    return true;
  }

  function getDiagnosticReport() {
    const cfg = getCfg();
    const lines = [];
    lines.push(`Configuracion: ${cfg.enabled ? 'activada' : 'desactivada'}`);
    lines.push(`Notification API: ${'Notification' in window ? 'si' : 'no'}`);
    lines.push(`Permiso: ${'Notification' in window ? Notification.permission : 'n/a'}`);
    lines.push(`Contexto seguro (https): ${window.isSecureContext ? 'si' : 'no'}`);
    lines.push(`ServiceWorker API: ${'serviceWorker' in navigator ? 'si' : 'no'}`);
    return lines.join(' | ');
  }

  function bindUi() {
    const bind = (id, handler) => {
      const el = byId(id);
      if (!el || el.dataset.bound === '1') return;
      el.dataset.bound = '1';
      el.addEventListener('click', handler);
    };

    bind('enableNotificationsBtn', () => {
      enableNotifications().catch(() => UI.toast('No se pudieron activar notificaciones', 'error'));
    });

    bind('notifEnableSettingsBtn', () => {
      enableNotifications().catch(() => UI.toast('No se pudieron activar notificaciones', 'error'));
    });

    bind('notifDisableSettingsBtn', disableNotifications);

    bind('notifTestSettingsBtn', () => {
      testNotification().catch(() => UI.toast('No se pudo enviar la prueba', 'error'));
    });

    bind('notifCheckDueSettingsBtn', () => {
      runCheck()
        .then((r) => {
          UI.toast('Revision de entregas ejecutada', 'success');
          setSettingsStatus(`Revision: ${r?.checked || 0} objetivo(s), notificados: ${r?.sent || 0}`);
        })
        .catch(() => UI.toast('No se pudo revisar entregas', 'error'));
    });

    bind('notifDiagSettingsBtn', () => {
      const report = getDiagnosticReport();
      setSettingsStatus(report);
      UI.toast('Diagnostico actualizado');
    });
  }

  function init() {
    bindUi();
    updateBadge();
    startLoop();

    setTimeout(() => {
      runCheck().catch(() => {});
    }, 2500);
  }

  return {
    init,
    runCheck,
    enableNotifications,
    disableNotifications,
    testNotification,
    updateBadge,
    getDiagnosticReport
  };
})();

if (typeof window !== 'undefined') {
  window.DeadlineNotifications = DeadlineNotifications;
}
