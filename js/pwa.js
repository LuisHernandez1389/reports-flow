/* pwa.js - installability and update flow */
'use strict';

(() => {
  let deferredPrompt = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function notify(msg, type = 'default') {
    if (window.UI?.toast) UI.toast(msg, type);
  }

  function setInstallButtonVisible(show) {
    const btn = byId('installAppBtn');
    if (!btn) return;
    btn.style.display = show ? 'inline-flex' : 'none';
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  async function promptInstall() {
    if (!deferredPrompt) {
      notify('Instalacion no disponible en este navegador', 'error');
      return;
    }

    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice?.outcome === 'accepted') {
      notify('Instalacion iniciada', 'success');
    } else {
      notify('Instalacion cancelada');
    }
    deferredPrompt = null;
    setInstallButtonVisible(false);
  }

  function wireInstallButton() {
    const btn = byId('installAppBtn');
    if (!btn) return;
    btn.addEventListener('click', promptInstall);
  }

  function handleBeforeInstallPrompt() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredPrompt = event;
      if (!isStandalone()) {
        setInstallButtonVisible(true);
        notify('Ya puedes instalar ProjectFlow en tu dispositivo', 'success');
      }
    });
  }

  function handleInstalledEvent() {
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
      setInstallButtonVisible(false);
      notify('ProjectFlow instalado correctamente', 'success');
    });
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('./service-worker.js');

        if (reg.waiting && navigator.serviceWorker.controller) {
          const ok = window.UI?.confirm
            ? await UI.confirm('Hay una nueva version disponible. Deseas actualizar ahora?', {
                title: 'Actualizacion disponible',
                confirmText: 'Actualizar',
                cancelText: 'Despues'
              })
            : false;
          if (ok) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }

        reg.addEventListener('updatefound', () => {
          const worker = reg.installing;
          if (!worker) return;
          worker.addEventListener('statechange', async () => {
            if (worker.state !== 'installed') return;
            if (!navigator.serviceWorker.controller) return;

            const ok = window.UI?.confirm
              ? await UI.confirm('Nueva version lista. Actualizar la app ahora?', {
                  title: 'Actualizar ProjectFlow',
                  confirmText: 'Actualizar',
                  cancelText: 'Mas tarde'
                })
              : false;
            if (ok && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
          });
        });

        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.location.reload();
        });
      } catch (_err) {
        // silent fail
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    wireInstallButton();
    setInstallButtonVisible(false);
    if (isStandalone()) setInstallButtonVisible(false);
    handleBeforeInstallPrompt();
    handleInstalledEvent();
    registerServiceWorker();
  });
})();
