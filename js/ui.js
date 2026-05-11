/* ui.js — UI utilities, navigation, modals */
'use strict';

const UI = (() => {
  let _confirmState = null;
  let _confirmBound = false;

  function byId(id) { return document.getElementById(id); }

  /* ---- NAVIGATION ---- */
  function navigate(view, extra) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const target = document.getElementById('view-' + view);
    if (target) target.classList.add('active');
    const navItem = document.querySelector(`.nav-item[data-view="${view}"]`);
    if (navItem) navItem.classList.add('active');
    const titles = { dashboard:'Dashboard', projects:'Proyectos', daily:'Trabajo Diario', reports:'Reportes', 'project-detail':'Detalle de Proyecto' };
    document.getElementById('pageTitle').textContent = titles[view] || 'ProjectFlow';
    window._currentView = view;
    if (view !== 'project-detail') window._activeProjectId = null;
    if (extra) window._activeProjectId = extra;
    // Close sidebar on mobile
    if (window.innerWidth <= 900) document.getElementById('sidebar').classList.remove('open');
    // Trigger view-specific refresh
    if (window.ViewHandlers && window.ViewHandlers[view]) window.ViewHandlers[view](extra);
  }

  /* ---- MODALS ---- */
  function openModal(id) {
    const overlay = byId('modalOverlay');
    const modal = byId(id);
    if (!overlay || !modal) return;
    overlay.classList.add('visible');
    modal.classList.add('visible');
  }

  function closeModal(id) {
    const overlay = byId('modalOverlay');
    const modal = byId(id);
    if (!modal) return;
    modal.classList.remove('visible');
    if (overlay && !document.querySelector('.modal.visible')) {
      overlay.classList.remove('visible');
    }
  }

  function closeAllModals() {
    const overlay = byId('modalOverlay');
    if (overlay) overlay.classList.remove('visible');
    document.querySelectorAll('.modal').forEach(m => m.classList.remove('visible'));
    if (_confirmState) {
      const resolve = _confirmState.resolve;
      _confirmState = null;
      resolve(false);
    }
  }

  /* ---- TOAST ---- */
  function toast(msg, type = 'default') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = 'toast'; }, 3000);
  }

  /* ---- FILE READING ---- */
  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ---- FILE DROP SETUP ---- */
  function setupFileDrop(dropEl, inputEl, previewEl, onFile) {
    dropEl.addEventListener('dragover', e => { e.preventDefault(); dropEl.style.borderColor = 'var(--accent)'; });
    dropEl.addEventListener('dragleave', () => { dropEl.style.borderColor = ''; });
    dropEl.addEventListener('drop', e => {
      e.preventDefault();
      dropEl.style.borderColor = '';
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    });
    dropEl.addEventListener('click', e => { if (!e.target.classList.contains('file-link')) inputEl.click(); });
    inputEl.addEventListener('change', () => { if (inputEl.files[0]) handleFile(inputEl.files[0]); });

    function handleFile(file) {
      readFileAsBase64(file).then(b64 => {
        if (previewEl) {
          previewEl.innerHTML = '';
          if (file.type.startsWith('image/')) {
            const img = document.createElement('img');
            img.src = b64;
            img.style.cssText = 'max-width:100%;max-height:150px;border-radius:8px;margin-top:8px;';
            previewEl.appendChild(img);
          } else {
            previewEl.innerHTML = `<p style="font-size:12px;color:var(--text-secondary);margin-top:6px;">📎 ${file.name}</p>`;
          }
        }
        if (onFile) onFile(b64, file.name, file.type, file);
      });
    }
  }

  /* ---- FORMAT DATE ---- */
  function fmtDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-MX', { day:'numeric', month:'short', year:'numeric' });
  }

  function fmtDateShort(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('es-MX', { day:'numeric', month:'short' });
  }

  /* ---- LIGHTBOX ---- */
  function lightbox(src) {
    const lb = document.createElement('div');
    lb.className = 'lightbox';
    lb.innerHTML = `<img src="${src}" alt="Vista ampliada">`;
    lb.onclick = () => lb.remove();
    document.body.appendChild(lb);
  }

  /* ---- CONFIRM ---- */
  function bindConfirmModal() {
    if (_confirmBound) return;
    const ok = byId('confirmModalOk');
    const cancel = byId('confirmModalCancel');
    const close = byId('confirmModalClose');
    if (!ok || !cancel || !close) return;

    ok.addEventListener('click', () => resolveConfirm(true));
    cancel.addEventListener('click', () => resolveConfirm(false));
    close.addEventListener('click', () => resolveConfirm(false));
    _confirmBound = true;
  }

  function resolveConfirm(answer) {
    if (!_confirmState) return;
    const resolve = _confirmState.resolve;
    _confirmState = null;
    closeModal('confirmModal');
    resolve(answer);
  }

  function confirm(msg, opts = {}) {
    bindConfirmModal();
    const title = byId('confirmModalTitle');
    const message = byId('confirmModalMessage');
    const ok = byId('confirmModalOk');
    const cancel = byId('confirmModalCancel');

    if (!title || !message || !ok || !cancel) return Promise.resolve(false);

    title.textContent = opts.title || 'Confirmar accion';
    message.textContent = String(msg || '');
    ok.textContent = opts.confirmText || 'Confirmar';
    cancel.textContent = opts.cancelText || 'Cancelar';
    ok.classList.remove('btn-danger');
    ok.classList.add('btn-primary');
    if (opts.danger) ok.classList.add('btn-danger');

    openModal('confirmModal');

    return new Promise(resolve => {
      _confirmState = { resolve };
    });
  }

  return { navigate, openModal, closeModal, closeAllModals, toast, readFileAsBase64, setupFileDrop, fmtDate, fmtDateShort, lightbox, confirm };
})();

