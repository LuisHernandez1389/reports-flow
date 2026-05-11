/* mode.js - app mode flags (normal / read-only) */
'use strict';

(() => {
  const q = new URLSearchParams(window.location.search);
  const p = String(window.location.pathname || '').toLowerCase();
  const readOnly =
    q.get('readonly') === '1' ||
    q.get('mode') === 'view' ||
    p.endsWith('/viewer.html');

  window.AppMode = {
    readOnly,
    isReadOnly() {
      return readOnly;
    }
  };

  if (readOnly && document?.body) {
    document.body.classList.add('read-only');
  }
})();

