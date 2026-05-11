/* data-utils.js - Export, Import & Demo Data */
'use strict';

const DataUtils = (() => {

  /* ---- EXPORT ALL DATA AS JSON ---- */
  function exportData() {
    const payload = {
      exportedAt: new Date().toISOString(),
      version: '1.0',
      projects: DB.projects.getAll(),
      objectives: DB.objectives.getAll(),
      progress: DB.progress.getAll(),
      dailyEntries: DB.daily.getAll()
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `projectflow-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    UI.toast('Datos exportados correctamente', 'success');
  }

  /* ---- IMPORT DATA FROM JSON ---- */
  function importData(file) {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.projects || !data.dailyEntries) throw new Error('Formato invalido');

        const ok = await UI.confirm(
          `Importar ${data.projects.length} proyectos y ${data.dailyEntries.length} entradas. Esto reemplazara los datos actuales.`,
          { title: 'Confirmar importacion', confirmText: 'Importar' }
        );
        if (!ok) return;

        localStorage.setItem('pf_projects', JSON.stringify(data.projects || []));
        localStorage.setItem('pf_projects_backup', JSON.stringify(data.projects || []));
        localStorage.setItem('pf_objectives', JSON.stringify(data.objectives || []));
        localStorage.setItem('pf_objectives_backup', JSON.stringify(data.objectives || []));
        localStorage.setItem('pf_progress', JSON.stringify(data.progress || []));
        localStorage.setItem('pf_progress_backup', JSON.stringify(data.progress || []));
        localStorage.setItem('pf_daily', JSON.stringify(data.dailyEntries || []));
        localStorage.setItem('pf_daily_backup', JSON.stringify(data.dailyEntries || []));

        UI.toast('Datos importados. Recargando...', 'success');
        setTimeout(() => location.reload(), 1200);
      } catch (_err) {
        UI.toast('Error al importar: archivo invalido', 'error');
      }
    };
    reader.readAsText(file);
  }

  /* ---- SEED DEMO DATA ---- */
  async function seedDemo() {
    const ok = await UI.confirm(
      'Cargar datos de demostracion. Esto agregara proyectos y entradas de ejemplo.',
      { title: 'Confirmar carga demo', confirmText: 'Cargar' }
    );
    if (!ok) return;

    const today = new Date();
    const fmt = (d) => d.toISOString().split('T')[0];
    const daysAgo = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return fmt(d); };

    // Demo Projects
    const p1 = DB.projects.add({
      name: 'Rediseno de Sitio Web',
      description: 'Modernizacion completa del sitio corporativo con nuevo branding y UX mejorada.',
      status: 'active', color: '#4F6EF7',
      startDate: daysAgo(30), endDate: fmt(new Date(today.getFullYear(), today.getMonth() + 2, 1))
    });
    const p2 = DB.projects.add({
      name: 'App Movil de Ventas',
      description: 'Aplicacion para el equipo de ventas con catalogo, pedidos y seguimiento de clientes.',
      status: 'active', color: '#22C55E',
      startDate: daysAgo(15)
    });
    const p3 = DB.projects.add({
      name: 'Migracion Base de Datos',
      description: 'Migracion del servidor legacy a la nube con zero downtime.',
      status: 'completed', color: '#8B5CF6',
      startDate: daysAgo(60), endDate: daysAgo(5)
    });

    // Objectives for p1
    const o1 = DB.objectives.add({ projectId: p1.id, title: 'Diseno de wireframes y prototipos', priority: 'high', progress: 100, done: true });
    const o2 = DB.objectives.add({ projectId: p1.id, title: 'Desarrollo frontend (React)', priority: 'high', progress: 60, done: false });
    const o3 = DB.objectives.add({ projectId: p1.id, title: 'Integracion con CMS', priority: 'medium', progress: 20, done: false });
    const o4 = DB.objectives.add({ projectId: p1.id, title: 'Testing y QA', priority: 'medium', progress: 0, done: false });

    // Objectives for p2
    const o5 = DB.objectives.add({ projectId: p2.id, title: 'Definicion de requerimientos', priority: 'high', progress: 100, done: true });
    const o6 = DB.objectives.add({ projectId: p2.id, title: 'Diseno de UI/UX', priority: 'high', progress: 80, done: false });
    const o7 = DB.objectives.add({ projectId: p2.id, title: 'Desarrollo API backend', priority: 'medium', progress: 40, done: false });

    // Objectives for p3
    const o8 = DB.objectives.add({ projectId: p3.id, title: 'Analisis y mapeo de datos', priority: 'high', progress: 100, done: true });
    const o9 = DB.objectives.add({ projectId: p3.id, title: 'Migracion en staging', priority: 'high', progress: 100, done: true });
    const o10 = DB.objectives.add({ projectId: p3.id, title: 'Go-live produccion', priority: 'high', progress: 100, done: true });

    // Progress entries
    DB.progress.add({ projectId: p1.id, objectiveId: o1.id, description: 'Wireframes completados para todas las paginas principales. Aprobados por el cliente.', percent: 100, hours: 2, date: daysAgo(18) });
    DB.progress.add({ projectId: p1.id, objectiveId: o2.id, description: 'Componentes base del design system listos. Header, footer y navegacion implementados.', percent: 40, hours: 3, date: daysAgo(10) });
    DB.progress.add({ projectId: p1.id, objectiveId: o2.id, description: 'Paginas de inicio y servicios terminadas. Animaciones implementadas con Framer Motion.', percent: 60, hours: 4, date: daysAgo(3) });
    DB.progress.add({ projectId: p2.id, objectiveId: o6.id, description: 'Pantallas de catalogo y carrito disenadas. En revision con stakeholders.', percent: 80, hours: 2.5, date: daysAgo(5) });
    DB.progress.add({ projectId: p3.id, objectiveId: o10.id, description: 'Migracion completada exitosamente. 0 errores, tiempos de respuesta mejorados 40%.', percent: 100, hours: 5, date: daysAgo(5) });

    // Daily entries
    const entries = [
      { title: 'Implementacion de componentes React', description: 'Cards, modales y formularios del nuevo diseno.', hours: 4, projectId: p1.id, category: 'desarrollo', date: daysAgo(0) },
      { title: 'Daily standup con el equipo', description: 'Revision de avances semanales y bloqueos.', hours: 0.5, projectId: p1.id, category: 'reunion', date: daysAgo(0) },
      { title: 'Diseno pantallas de catalogo', description: 'Maquetas de alta fidelidad en Figma para la vista de productos.', hours: 3, projectId: p2.id, category: 'diseno', date: daysAgo(1) },
      { title: 'Revision de arquitectura API', description: 'Analisis de endpoints necesarios para la app movil.', hours: 2, projectId: p2.id, category: 'investigacion', date: daysAgo(1) },
      { title: 'Correcciones de UI en feedback del cliente', description: 'Ajustes de colores, tipografia y espaciados segun comentarios recibidos.', hours: 2.5, projectId: p1.id, category: 'diseno', date: daysAgo(2) },
      { title: 'Pruebas de migracion en staging', description: 'Validacion de integridad de datos post-migracion.', hours: 5, projectId: p3.id, category: 'desarrollo', date: daysAgo(7) },
      { title: 'Documentacion tecnica', description: 'Actualizacion del README y guias de despliegue.', hours: 1.5, projectId: p3.id, category: 'desarrollo', date: daysAgo(8) },
      { title: 'Reunion de kick-off App Movil', description: 'Presentacion inicial, definicion de alcance y entregables.', hours: 2, projectId: p2.id, category: 'reunion', date: daysAgo(14) }
    ];

    entries.forEach((e) => DB.daily.add(e));

    UI.toast('Datos de demo cargados', 'success');
    setTimeout(() => location.reload(), 800);
  }

  /* ---- CLEAR ALL DATA ---- */
  async function clearAll() {
    const ok = await UI.confirm(
      'Eliminar TODOS los datos. Esta accion no se puede deshacer.',
      { title: 'Zona de peligro', confirmText: 'Eliminar todo', danger: true }
    );
    if (!ok) return;

    ['pf_projects', 'pf_objectives', 'pf_progress', 'pf_daily'].forEach((k) => {
      localStorage.removeItem(k);
      localStorage.removeItem(k + '_backup');
    });
    Object.keys(localStorage).filter((k) => k.startsWith('pf_file_')).forEach((k) => localStorage.removeItem(k));

    UI.toast('Datos eliminados. Recargando...', 'success');
    setTimeout(() => location.reload(), 1000);
  }

  return { exportData, importData, seedDemo, clearAll };
})();
