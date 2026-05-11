/* auth.js - basic access gate for normal mode */
'use strict';

const Auth = (() => {
  const SESSION_KEY = 'pf_auth_ok';
  const USER_KEY = 'pf_auth_user';

  // Simple credentials for normal mode.
  const CREDENTIALS = {
    user: 'admin',
    pass: 'flow2026'
  };

  let resolver = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function isLogged() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function lock() {
    document.body.classList.add('app-locked');
    const err = byId('authError');
    if (err) err.textContent = '';
    const pass = byId('authPass');
    if (pass) pass.value = '';
    const user = byId('authUser');
    if (user) user.focus();
  }

  function unlock() {
    document.body.classList.remove('app-locked');
  }

  function showLogout() {
    const btn = byId('logoutBtn');
    if (!btn) return;
    const isRO = !!window.AppMode?.isReadOnly?.();
    btn.style.display = isRO ? 'none' : 'flex';
  }

  function validate(user, pass) {
    return user === CREDENTIALS.user && pass === CREDENTIALS.pass;
  }

  function handleSubmit(e) {
    e.preventDefault();
    const user = (byId('authUser')?.value || '').trim();
    const pass = byId('authPass')?.value || '';
    const err = byId('authError');

    if (!validate(user, pass)) {
      if (err) err.textContent = 'Credenciales invalidas.';
      return;
    }

    sessionStorage.setItem(SESSION_KEY, '1');
    sessionStorage.setItem(USER_KEY, user);
    if (err) err.textContent = '';
    unlock();

    if (resolver) {
      resolver(true);
      resolver = null;
    }
  }

  function bind() {
    const form = byId('authForm');
    if (!form || form.dataset.bound === '1') return;
    form.addEventListener('submit', handleSubmit);
    form.dataset.bound = '1';
  }

  async function enforce() {
    if (window.AppMode?.isReadOnly?.()) {
      unlock();
      return true;
    }

    bind();
    showLogout();

    if (isLogged()) {
      unlock();
      return true;
    }

    lock();
    return new Promise(resolve => {
      resolver = resolve;
    });
  }

  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(USER_KEY);
    lock();
  }

  function init() {
    if (window.AppMode?.isReadOnly?.()) {
      unlock();
      showLogout();
      return;
    }

    bind();
    showLogout();

    if (isLogged()) unlock();
    else lock();
  }

  return { enforce, logout, init };
})();

if (typeof window !== 'undefined') {
  window.Auth = Auth;
}

document.addEventListener('DOMContentLoaded', () => {
  Auth.init();
});
