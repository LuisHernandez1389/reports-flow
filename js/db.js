/* db.js — Local JSON database using localStorage */
'use strict';

const DB = (() => {
  const KEYS = {
    projects: 'pf_projects',
    objectives: 'pf_objectives',
    progress: 'pf_progress',
    dailyEntries: 'pf_daily'
  };

  function load(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || '[]');
      if (Array.isArray(parsed)) return parsed;
    } catch {}
    try {
      const backup = JSON.parse(localStorage.getItem(key + '_backup') || '[]');
      if (Array.isArray(backup)) {
        localStorage.setItem(key, JSON.stringify(backup));
        return backup;
      }
    } catch {}
    return [];
  }

  function save(key, data) {
    if (window.AppMode?.isReadOnly?.()) return;
    const raw = JSON.stringify(data);
    localStorage.setItem(key, raw);
    localStorage.setItem(key + '_backup', raw);
    if (window.SupabaseData) SupabaseData.scheduleSync();
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---- PROJECTS ---- */
  const projects = {
    getAll() { return load(KEYS.projects); },
    getById(id) { return this.getAll().find(p => p.id === id) || null; },
    add(data) {
      const all = this.getAll();
      const item = { id: uid(), createdAt: new Date().toISOString(), ...data };
      all.unshift(item);
      save(KEYS.projects, all);
      return item;
    },
    update(id, data) {
      const all = this.getAll();
      const idx = all.findIndex(p => p.id === id);
      if (idx < 0) return null;
      all[idx] = { ...all[idx], ...data, updatedAt: new Date().toISOString() };
      save(KEYS.projects, all);
      return all[idx];
    },
    delete(id) {
      save(KEYS.projects, this.getAll().filter(p => p.id !== id));
      objectives.deleteByProject(id);
      progress.deleteByProject(id);
    }
  };

  /* ---- OBJECTIVES ---- */
  const objectives = {
    getAll() { return load(KEYS.objectives); },
    getByProject(projectId) { return this.getAll().filter(o => o.projectId === projectId); },
    getById(id) { return this.getAll().find(o => o.id === id) || null; },
    add(data) {
      const all = this.getAll();
      const item = { id: uid(), createdAt: new Date().toISOString(), progress: 0, done: false, ...data };
      all.unshift(item);
      save(KEYS.objectives, all);
      return item;
    },
    update(id, data) {
      const all = this.getAll();
      const idx = all.findIndex(o => o.id === id);
      if (idx < 0) return null;
      all[idx] = { ...all[idx], ...data };
      save(KEYS.objectives, all);
      return all[idx];
    },
    delete(id) { save(KEYS.objectives, this.getAll().filter(o => o.id !== id)); },
    deleteByProject(projectId) { save(KEYS.objectives, this.getAll().filter(o => o.projectId !== projectId)); }
  };

  /* ---- PROGRESS ENTRIES (project advances) ---- */
  const progress = {
    getAll() { return load(KEYS.progress); },
    getByProject(projectId) { return this.getAll().filter(p => p.projectId === projectId); },
    getByObjective(objectiveId) { return this.getAll().filter(p => p.objectiveId === objectiveId); },
    getByDate(date) { return this.getAll().filter(p => p.date === date); },
    getByWeek(startDate, endDate) {
      return this.getAll().filter(p => p.date >= startDate && p.date <= endDate);
    },
    add(data) {
      const all = this.getAll();
      const item = { id: uid(), createdAt: new Date().toISOString(), date: new Date().toISOString().split('T')[0], ...data };
      all.unshift(item);
      save(KEYS.progress, all);
      return item;
    },
    delete(id) { save(KEYS.progress, this.getAll().filter(p => p.id !== id)); },
    deleteByProject(projectId) { save(KEYS.progress, this.getAll().filter(p => p.projectId !== projectId)); }
  };

  /* ---- DAILY WORK ENTRIES ---- */
  const daily = {
    getAll() { return load(KEYS.dailyEntries); },
    getByDate(date) { return this.getAll().filter(e => e.date === date); },
    getByWeek(startDate, endDate) {
      return this.getAll().filter(e => e.date >= startDate && e.date <= endDate);
    },
    getByProject(projectId) { return this.getAll().filter(e => e.projectId === projectId); },
    add(data) {
      const all = this.getAll();
      const item = { id: uid(), createdAt: new Date().toISOString(), date: new Date().toISOString().split('T')[0], ...data };
      all.unshift(item);
      save(KEYS.dailyEntries, all);
      return item;
    },
    update(id, data) {
      const all = this.getAll();
      const idx = all.findIndex(e => e.id === id);
      if (idx < 0) return null;
      all[idx] = { ...all[idx], ...data };
      save(KEYS.dailyEntries, all);
      return all[idx];
    },
    delete(id) { save(KEYS.dailyEntries, this.getAll().filter(e => e.id !== id)); }
  };

  /* ---- FILE STORAGE (base64 in localStorage) ---- */
  const files = {
    save(id, base64) { localStorage.setItem('pf_file_' + id, base64); },
    get(id) {
      if (typeof id === 'string' && id.startsWith('http')) return id;
      return localStorage.getItem('pf_file_' + id) || null;
    },
    delete(id) {
      if (typeof id === 'string' && id.startsWith('http') && window.SupabaseStorage) {
        SupabaseStorage.deleteByStoredValue(id).catch(() => {});
        return;
      }
      localStorage.removeItem('pf_file_' + id);
    }
  };

  /* ---- STATS HELPERS ---- */
  function getWeekDates(offsetWeeks = 0) {
    const now = new Date();
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offsetWeeks * 7);
    monday.setHours(0,0,0,0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return {
      start: monday.toISOString().split('T')[0],
      end: sunday.toISOString().split('T')[0],
      days: Array.from({length:7}, (_,i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        return d.toISOString().split('T')[0];
      })
    };
  }

  function getProjectProgress(projectId) {
    const objs = objectives.getByProject(projectId);
    if (!objs.length) return 0;
    const total = objs.reduce((sum, o) => sum + (o.progress || 0), 0);
    return Math.round(total / objs.length);
  }

  function getActivityEntries() {
    const dailyEntries = daily.getAll().map((e) => ({ ...e, entryType: 'daily' }));
    const progressEntries = progress.getAll().map((e) => ({
      ...e,
      entryType: 'progress',
      title: e.title || 'Avance de proyecto',
      category: e.category || 'avance'
    }));
    return [...dailyEntries, ...progressEntries]
      .sort((a, b) => {
        const da = `${a.date || ''}T${a.createdAt || ''}`;
        const db = `${b.date || ''}T${b.createdAt || ''}`;
        return db.localeCompare(da);
      });
  }

  function getActivityByWeek(startDate, endDate) {
    return getActivityEntries().filter(e => e.date >= startDate && e.date <= endDate);
  }

  return { projects, objectives, progress, daily, files, uid, getWeekDates, getProjectProgress, getActivityEntries, getActivityByWeek };
})();

