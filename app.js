/* ==========================================================
   LUXION — aplicación personal offline
   Datos guardados localmente. Copia opcional mediante Apps Script.
   ========================================================== */

const STORAGE_KEY = 'luxion-data-v1';
const TARGET_DATE = new Date(2027, 2, 1, 0, 0, 0);
const CUP_ML = 250;
const MAX_EMERGENCY_PER_MONTH = 4;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

function freshState() {
  return {
    version: 1,
    days: {},
    penalties: [],
    emergencyUses: {},
    plannedEmergency: {},
    topics: {},
    scores: [],
    careDates: {},
    drive: { url: '', key: '', lastSent: '' },
    settings: { keepAwake: false, alertsEnabled: false }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw);
    const base = freshState();
    return {
      ...base,
      ...parsed,
      drive: { ...base.drive, ...(parsed.drive || {}) },
      settings: { ...base.settings, ...(parsed.settings || {}) },
      days: parsed.days || {},
      penalties: parsed.penalties || [],
      emergencyUses: parsed.emergencyUses || {},
      plannedEmergency: parsed.plannedEmergency || {},
      topics: parsed.topics || {},
      scores: parsed.scores || [],
      careDates: parsed.careDates || {}
    };
  } catch (error) {
    console.warn('No se pudo leer el registro local:', error);
    return freshState();
  }
}

let state = loadState();
let activeTab = 'inicio';
let alertAudioContext = null;
let wakeLock = null;
let installPromptEvent = null;
let examInterval = null;
let examRemaining = 180 * 60;
let examRunning = false;
let lastAutoSync = 0;
let saveSyncTimer = null;

function dateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date, amount) {
  const result = new Date(date);
  result.setDate(result.getDate() + amount);
  return result;
}

function formatDate(date = new Date()) {
  return new Intl.DateTimeFormat('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

function formatDuration(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = String(Math.floor(safe / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, '0');
  const secs = String(safe % 60).padStart(2, '0');
  return `${hours}:${minutes}:${secs}`;
}

function timeRange(start, end) {
  return `${formatClock(start)} – ${formatClock(end)}`;
}

function formatClock(value) {
  const [hours, minutes] = value.split(':').map(Number);
  const suffix = hours >= 12 ? 'p. m.' : 'a. m.';
  const hour12 = hours % 12 || 12;
  return `${String(hour12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

function currentMonthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function ensureDay(key = dateKey()) {
  if (!state.days[key]) {
    state.days[key] = { done: {}, water: 0, journal: '', closed: false, emergency: Boolean(state.plannedEmergency[key]), missed: {}, nightPrompted: false, violations: [] };
  }
  if (typeof state.days[key].water !== 'number') state.days[key].water = 0;
  if (!state.days[key].done) state.days[key].done = {};
  if (!state.days[key].missed) state.days[key].missed = {};
  if (!state.days[key].violations) state.days[key].violations = [];
  return state.days[key];
}

const WEEK_PLAN = {
  0: {
    morning: { title: 'Domingo · recuperación + simulacro', focus: 'Recuperación muscular y técnica suave. El simulacro va en el bloque de 2:00 p. m. a 6:00 p. m.', items: [['Movilidad completa', '10 min'], ['Caminata suave o técnica con balón', '15–20 min'], ['Respiración y estiramiento cómodo', '5 min']] },
    evening: { title: 'Descarga y preparación', focus: 'Nada de fuerza intensa. Deja que el cuerpo asimile la semana.', items: [['Movilidad de cadera y tobillo', '8 min'], ['Movilidad torácica y hombros', '5 min'], ['Respiración tranquila', '3 min']] }
  },
  1: {
    morning: { title: 'Lunes · fuerza de piernas', focus: 'Técnica controlada. Deja 2 repeticiones posibles antes del fallo.', items: [['Sentadilla con mochila', '3 × 8–12'], ['Zancada atrás', '3 × 8 por pierna'], ['Puente de glúteos', '3 × 12–15'], ['Elevación de pantorrillas', '3 × 15–20'], ['Plancha', '3 × 20–35 s']] },
    evening: { title: 'Movilidad + descarga', focus: 'Sesión ligera. No conviertas la noche en otro entrenamiento pesado.', items: [['Caminata fácil', '8–10 min'], ['Movilidad de tobillos y cadera', '8 min'], ['Estiramiento suave', '5 min']] }
  },
  2: {
    morning: { title: 'Martes · tren superior y core', focus: 'Espalda, pecho, hombros y abdomen con control.', items: [['Flexiones (variante cómoda)', '3 × 6–12'], ['Remo con mochila', '3 × 10–12'], ['Press de suelo con mancuernas caseras seguras', '2 × 8–10'], ['Pájaro-perro', '3 × 8 por lado'], ['Plancha lateral', '2 × 20 s por lado']] },
    evening: { title: 'Técnica de fútbol suave', focus: 'Prioriza coordinación y control, no sprints máximos.', items: [['Toques y conducción de balón', '10 min'], ['Pases contra pared', '8 min'], ['Movilidad de cadera', '5 min']] }
  },
  3: {
    morning: { title: 'Miércoles · resistencia base', focus: 'Ritmo conversacional: debes poder hablar. No es una prueba de velocidad.', items: [['Caminata rápida o trote fácil', '20–25 min'], ['Movilidad dinámica', '8 min'], ['Core suave', '2 × 20 s']] },
    evening: { title: 'Recuperación activa', focus: 'Día de carga baja para recuperar piernas y articulaciones.', items: [['Movilidad general', '10 min'], ['Estiramiento suave', '8 min'], ['Respiración nasal tranquila', '3 min']] }
  },
  4: {
    morning: { title: 'Jueves · piernas + potencia técnica', focus: 'Primero fuerza con técnica. Saltos bajos solo si no hay dolor ni fatiga.', items: [['Sentadilla dividida', '3 × 8 por pierna'], ['Peso muerto rumano con mochila', '3 × 10'], ['Step-up a escalón estable', '2 × 8 por pierna'], ['Saltos verticales bajos y controlados', '3 × 4'], ['Pantorrilla', '2 × 15']] },
    evening: { title: 'Movilidad y prevención', focus: 'Sin carga adicional de piernas.', items: [['Movilidad de tobillos', '5 min'], ['Movilidad de cadera', '5 min'], ['Estabilidad de rodilla a una pierna', '2 × 20 s']] }
  },
  5: {
    morning: { title: 'Viernes · fuerza general', focus: 'Trabajo moderado de cuerpo completo.', items: [['Flexiones', '3 × 6–12'], ['Remo con mochila', '3 × 10'], ['Sentadilla a ritmo cómodo', '2 × 12'], ['Puente de glúteos', '2 × 15'], ['Dead bug', '2 × 8 por lado']] },
    evening: { title: 'Soltar tensión', focus: 'Sesión corta para llegar fresco al sábado.', items: [['Caminata tranquila', '8 min'], ['Movilidad de espalda y hombros', '8 min'], ['Respiración', '3 min']] }
  },
  6: {
    morning: { title: 'Sábado · velocidad y resistencia futbolística', focus: 'Calienta 10 minutos. Aumenta la intensidad poco a poco; termina si la técnica se deteriora.', items: [['Calentamiento dinámico', '10 min'], ['Aceleraciones submáximas', '4 × 10–15 m'], ['Cambios de dirección controlados', '4 × 15 s'], ['Pases y control de balón', '10 min'], ['Vuelta a la calma', '5 min']] },
    evening: { title: 'Recuperación', focus: 'Hidrátate, cena y duerme a tiempo.', items: [['Movilidad suave', '10 min'], ['Estiramientos cómodos', '5 min']] }
  }
};

function buildTasks(key = dateKey()) {
  const date = parseDate(key);
  const day = ensureDay(key);
  if (day.emergency) {
    return [
      { id: 'wake', title: 'Despertar, agua y rutina facial AM', start: '05:30', end: '06:00', note: 'Despierta antes de las 6:00 a. m. y protege tu piel.' },
      { id: 'breakfast', title: 'Desayuno y preparación', start: '07:00', end: '07:45', note: 'Comida casera equilibrada.' },
      { id: 'quickStudy', title: 'Repaso esencial de 20 minutos', start: '07:45', end: '08:05', note: 'Recuperación activa: recuerda sin mirar y comprueba.' },
      { id: 'lunch', title: 'Almuerzo y pausa', start: '12:00', end: '14:00', note: 'Come suficiente y descansa.' },
      { id: 'dinner', title: 'Cena ligera y repaso breve', start: '18:00', end: '19:30', note: 'Sin extender el estudio.' },
      { id: 'workoutPM', title: 'Movilidad suave / descarga', start: '19:30', end: '20:00', note: 'Solo si te sientes bien; sin carga intensa.' },
      { id: 'facePM', title: 'Rutina facial PM y preparación', start: '20:30', end: '21:15', note: 'Limpieza suave, hidratación y preparar mañana.' },
      { id: 'journal', title: 'Diario nocturno y cierre', start: '21:15', end: '21:45', note: 'Reflexiona y cierra antes de dormir.' }
    ];
  }

  const tasks = [
    { id: 'wake', title: 'Despertar, vaso de agua y rutina facial AM', start: '05:30', end: '06:00', note: 'Límite máximo para despertar: 6:00 a. m.' },
    { id: 'workoutAM', title: 'Entrenamiento principal + ducha', start: '06:00', end: '07:00', note: 'Sigue el plan del día. Técnica antes que velocidad.' },
    { id: 'breakfast', title: 'Desayuno balanceado y preparación', start: '07:00', end: '07:45', note: 'Proteína, fruta o verdura y energía suficiente.' },
    { id: 'study1', title: 'Estudio profundo · sesión 1', start: '07:45', end: '09:00', note: 'Teoría y memoria con recuperación activa.' },
    { id: 'study2', title: 'Estudio profundo · sesión 2', start: '09:10', end: '10:25', note: 'Continúa temario; pausa breve entre sesiones.' },
    { id: 'study3', title: 'Estudio y problemas · sesión 3', start: '10:35', end: '12:00', note: 'Cierra con ejercicios y lista de errores.' },
    { id: 'lunch', title: 'Almuerzo y alistamiento', start: '12:00', end: '14:00', note: 'Comida casera; deja listo lo necesario.' }
  ];

  const dayOfWeek = date.getDay();
  if (dayOfWeek >= 1 && dayOfWeek <= 5) {
    tasks.push({ id: 'classes', title: 'Bloque de clases / actividades académicas', start: '14:00', end: '18:00', note: 'Asistencia, apuntes y pendientes del instituto.' });
  } else if (dayOfWeek === 0) {
    tasks.push({ id: 'weekendRecovery', title: 'Simulacro dominical + revisión y recuperación', start: '14:00', end: '18:00', note: 'Simulacro real, revisar errores y reparar tareas pendientes.' });
  } else {
    tasks.push({ id: 'weekendRecovery', title: 'Refuerzo y recuperación semanal', start: '14:00', end: '18:00', note: 'Pagar pendientes con bloques razonables; no duplicar entrenamiento.' });
  }

  tasks.push(
    { id: 'dinner', title: 'Cena ligera + repaso rápido', start: '18:00', end: '19:30', note: 'Revisión breve, sin empezar temas enormes.' },
    { id: 'workoutPM', title: 'Movilidad / descarga + ducha rápida', start: '19:30', end: '20:30', note: 'Sesión de carga baja definida en el plan físico.' },
    { id: 'facePM', title: 'Rutina facial PM + postura + preparar mañana', start: '20:30', end: '21:15', note: 'Cuida la piel y deja preparada la ropa/material.' },
    { id: 'journal', title: 'Diario nocturno y revisión LUXION', start: '21:15', end: '21:45', note: 'Cierre del sistema. Pantallas fuera antes de las 10:00 p. m.' }
  );
  return tasks;
}

function getDayProgress(key = dateKey()) {
  const day = ensureDay(key);
  const tasks = buildTasks(key);
  const completed = tasks.filter((task) => Boolean(day.done[task.id])).length;
  const total = tasks.length;
  return { tasks, completed, total, percent: total ? Math.round((completed / total) * 100) : 0, won: completed === total };
}

function saveState(trySync = true) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error('No se pudo guardar en el dispositivo:', error);
    setText('#backupStatus', 'El almacenamiento local está lleno o bloqueado. Descarga una copia de seguridad.');
  }
  if (trySync) queueDriveSync();
}

function setText(selector, text) {
  const element = $(selector);
  if (element) element.textContent = text;
}

function getOpenPenalties() {
  return state.penalties.filter((penalty) => !penalty.resolved);
}

function getResolvedPenalties() {
  return state.penalties.filter((penalty) => penalty.resolved);
}

function nextSundayKey(fromDate = new Date()) {
  const date = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  const daysUntilSunday = (7 - date.getDay()) % 7;
  return dateKey(addDays(date, daysUntilSunday));
}

function createPenalty(title, detail, kind = 'reparación') {
  const penalty = {
    id: `p-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    detail,
    kind,
    created: dateKey(),
    due: nextSundayKey(),
    resolved: false,
    resolution: ''
  };
  state.penalties.push(penalty);
  return penalty;
}

function processOverdueTasks() {
  const now = new Date();
  const key = dateKey(now);
  const day = ensureDay(key);
  const minuteNow = now.getHours() * 60 + now.getMinutes();
  const tasks = buildTasks(key);
  let changed = false;
  tasks.forEach((task) => {
    if (!day.done[task.id] && minuteNow > toMinutes(task.end) && !day.missed[task.id]) {
      day.missed[task.id] = true;
      const already = state.penalties.some((penalty) => !penalty.resolved && penalty.taskId === `${key}:${task.id}`);
      if (!already) {
        const penalty = createPenalty(`Reprogramar: ${task.title}`, `Tarea no marcada dentro de su horario (${timeRange(task.start, task.end)}). Reserva 25 minutos para completarla o revisar el motivo. No se duplican repeticiones ni se sacrifica el sueño.`, 'tarea');
        penalty.taskId = `${key}:${task.id}`;
      }
      changed = true;
    }
  });
  if (changed) saveState();
}

function resolveTaskPenalty(key, taskId) {
  const targetId = `${key}:${taskId}`;
  state.penalties.forEach((penalty) => {
    if (!penalty.resolved && penalty.taskId === targetId) {
      penalty.resolved = true;
      penalty.resolution = 'La tarea se completó y se revisó el retraso.';
    }
  });
}

function markTask(taskId, checked, key = dateKey()) {
  const day = ensureDay(key);
  day.done[taskId] = checked;
  if (checked) resolveTaskPenalty(key, taskId);
  saveState();
  renderAll();
  if (getDayProgress(key).won) setText('#luxionMessage', '100% registrado. Día ganado. Ahora protege la recuperación y el sueño.');
  else if (checked) setText('#luxionMessage', 'Tarea registrada. No te distraigas: continúa con el siguiente bloque.');
}

function activateEmergency(key = dateKey()) {
  const month = currentMonthKey(parseDate(key));
  const used = state.emergencyUses[month] || 0;
  const day = ensureDay(key);
  if (day.emergency) {
    alert('El protocolo ya está activo para esta fecha.');
    return;
  }
  if (used >= MAX_EMERGENCY_PER_MONTH) {
    alert('Límite mensual alcanzado. LUXION no permite más de 4 usos al mes.');
    return;
  }
  const label = key === dateKey() ? 'hoy' : 'mañana';
  const accepted = confirm(`¿Confirmas una jornada laboral imprevista para ${label}? Se conservarán cuidado facial, comida, repaso breve, movilidad y hora de dormir. Los bloques pausados no generarán penalización.`);
  if (!accepted) return;
  day.emergency = true;
  state.emergencyUses[month] = used + 1;
  delete state.plannedEmergency[key];
  saveState();
  renderAll();
  setText('#luxionMessage', 'Modo excepcional activado. Haz lo esencial con atención y vuelve mañana al horario normal.');
}

function updateConnectionStatus() {
  const pill = $('#connectionStatus');
  if (!pill) return;
  pill.classList.toggle('offline', !navigator.onLine);
  pill.querySelector('span').textContent = navigator.onLine ? 'En línea' : 'Sin internet';
}

function renderCountdown() {
  const now = new Date();
  const remaining = Math.max(0, Math.floor((TARGET_DATE - now) / 1000));
  const days = Math.floor(remaining / 86400);
  const hours = Math.floor((remaining % 86400) / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const values = [days, hours, minutes];
  const els = $$('#countdown strong');
  els.forEach((element, index) => element.textContent = String(values[index]).padStart(index === 0 ? 3 : 2, '0'));
}

function getBlocksForDate(key = dateKey()) {
  const dayDate = parseDate(key);
  const day = ensureDay(key);
  if (day.emergency) return [
    { id: 'wake', title: 'Despertar y cuidado AM', start: '05:30', end: '06:00' },
    { id: 'breakfast', title: 'Desayuno', start: '07:00', end: '07:45' },
    { id: 'quickStudy', title: 'Repaso esencial', start: '07:45', end: '08:05' },
    { id: 'lunch', title: 'Almuerzo y pausa', start: '12:00', end: '14:00' },
    { id: 'dinner', title: 'Cena y repaso breve', start: '18:00', end: '19:30' },
    { id: 'workoutPM', title: 'Movilidad opcional', start: '19:30', end: '20:00' },
    { id: 'facePM', title: 'Rutina facial PM', start: '20:30', end: '21:15' },
    { id: 'journal', title: 'Diario y cierre', start: '21:15', end: '21:45' },
    { id: 'sleep', title: 'Apagar pantallas y dormir', start: '22:00', end: '23:59' }
  ];
  const weekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
  return [
    { id: 'wake', title: 'Despertar, agua y rutina AM', start: '05:30', end: '06:00' },
    { id: 'workoutAM', title: 'Entrenamiento principal', start: '06:00', end: '07:00' },
    { id: 'breakfast', title: 'Desayuno y preparación', start: '07:00', end: '07:45' },
    { id: 'study', title: 'Estudio preuniversitario', start: '07:45', end: '12:00' },
    { id: 'lunch', title: 'Almuerzo y alistamiento', start: '12:00', end: '14:00' },
    { id: weekend ? 'weekendRecovery' : 'classes', title: weekend ? 'Refuerzo y recuperación' : 'Clases / actividades', start: '14:00', end: '18:00' },
    { id: 'dinner', title: 'Cena y repaso breve', start: '18:00', end: '19:30' },
    { id: 'workoutPM', title: 'Movilidad y descarga', start: '19:30', end: '20:30' },
    { id: 'facePM', title: 'Rutina facial PM y preparación', start: '20:30', end: '21:15' },
    { id: 'journal', title: 'Diario nocturno', start: '21:15', end: '21:45' },
    { id: 'sleep', title: 'Hora de dormir', start: '22:00', end: '23:59' }
  ];
}

function renderSchedule() {
  const key = dateKey();
  const day = ensureDay(key);
  const { tasks, completed, total, percent } = getDayProgress(key);
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes();
  const blocks = getBlocksForDate(key);
  const current = blocks.find((block) => minutes >= toMinutes(block.start) && minutes < toMinutes(block.end));
  const next = blocks.find((block) => toMinutes(block.start) > minutes);
  const block = current || next;
  const currentBlock = $('#currentBlock');
  const timer = $('#blockTimer');
  if (block) {
    const endTime = parseDate(key);
    endTime.setHours(Number(block.end.split(':')[0]), Number(block.end.split(':')[1]), 0, 0);
    if (!current) {
      const startTime = parseDate(key);
      startTime.setHours(Number(block.start.split(':')[0]), Number(block.start.split(':')[1]), 0, 0);
      timer.textContent = `INICIA EN ${formatDuration((startTime - now) / 1000)}`;
      currentBlock.querySelector('strong').textContent = `Siguiente: ${block.title}`;
      currentBlock.querySelector('small').textContent = `Comienza ${formatClock(block.start)}.`;
    } else {
      timer.textContent = formatDuration((endTime - now) / 1000);
      currentBlock.querySelector('strong').textContent = block.title;
      currentBlock.querySelector('small').textContent = `Termina ${formatClock(block.end)}. Mantén el ritmo y cuida la técnica.`;
    }
  } else {
    timer.textContent = '00:00:00';
    currentBlock.querySelector('strong').textContent = 'Ciclo terminado';
    currentBlock.querySelector('small').textContent = 'Apaga pantallas y duerme. Mañana se vuelve a ejecutar.';
  }

  $('#todayLabel').textContent = new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: 'short' }).format(now).toUpperCase();
  $('#dailyProgressBar').style.width = `${percent}%`;
  $('#dailyProgressText').textContent = `${completed} de ${total} tareas`;
  $('#dailyPercent').textContent = `${percent}%`;
  const list = $('#dailyTasks');
  list.innerHTML = '';
  tasks.forEach((task) => {
    const row = document.createElement('label');
    row.className = 'task-row';
    if (day.done[task.id]) row.classList.add('done');
    if (!day.done[task.id] && minutes > toMinutes(task.end)) row.classList.add('overdue');
    const left = document.createElement('span');
    left.className = 'task-main';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-check';
    checkbox.checked = Boolean(day.done[task.id]);
    checkbox.addEventListener('change', () => markTask(task.id, checkbox.checked));
    const copy = document.createElement('span');
    copy.className = 'task-copy';
    const title = document.createElement('strong');
    title.textContent = task.title;
    const note = document.createElement('small');
    note.textContent = task.note;
    copy.append(title, note);
    left.append(checkbox, copy);
    const time = document.createElement('span');
    time.className = 'task-time';
    time.textContent = timeRange(task.start, task.end);
    row.append(left, time);
    list.appendChild(row);
  });
  $('#streakValue').innerHTML = `${calculateStreak()}<span> días</span>`;
  $('#streakMessage').textContent = percent === 100 ? 'Día completo. Protege el descanso.' : 'La racha se mantiene solo con días al 100%.';
  $('#penaltiesOpen').textContent = getOpenPenalties().length;
  $('#penaltiesDone').textContent = getResolvedPenalties().length;
  const month = currentMonthKey();
  const remaining = Math.max(0, MAX_EMERGENCY_PER_MONTH - (state.emergencyUses[month] || 0));
  $('#emergencyCount').textContent = remaining;
  $('#emergencyButton').disabled = day.emergency || remaining === 0;
  $('#emergencyButton').textContent = day.emergency ? 'Modo activo para hoy' : 'Activar para hoy';
  $('#emergencyStatus').textContent = day.emergency ? 'Modo excepcional activo: tareas esenciales únicamente.' : 'La jornada excepcional no debe convertirse en hábito.';
}

function calculateStreak() {
  let cursor = new Date();
  const todayKey = dateKey(cursor);
  if (!getDayProgress(todayKey).won) cursor = addDays(cursor, -1);
  let streak = 0;
  for (let count = 0; count < 500; count += 1) {
    const key = dateKey(cursor);
    if (!state.days[key]) break;
    if (!getDayProgress(key).won) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

function renderPhysical() {
  const weekday = new Date().getDay();
  const plan = WEEK_PLAN[weekday];
  const day = ensureDay();
  $('#workoutDayTag').textContent = day.emergency ? 'MODO EXCEPCIONAL' : ['DOM', 'LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁB'][weekday];
  if (day.emergency) {
    $('#morningWorkout').innerHTML = '<div class="workout-info"><h3>Sesión principal pausada</h3><p>Hoy el protocolo laboral deja en pausa la fuerza y la potencia. No intentes recuperar esta carga por la noche.</p><ul class="exercise-list"><li><b>Pausa y recuperación</b><span>sin series</span></li><li><b>Prioriza comida y descanso</b><span>esencial</span></li></ul></div><div class="workout-info"><h3>LUXION indica</h3><p>Conserva las tareas esenciales. La sesión de entrenamiento volverá cuando termine la jornada excepcional.</p></div>';
    $('#eveningWorkout').innerHTML = '<div class="workout-info"><h3>Movilidad opcional</h3><p>Solo si te encuentras bien. Muévete sin dolor y sin convertirlo en una sesión intensa.</p><ul class="exercise-list"><li><b>Movilidad suave de cadera y tobillos</b><span>5–10 min</span></li><li><b>Respiración tranquila</b><span>2–3 min</span></li></ul><p>Este bloque es opcional y no reemplaza el descanso.</p></div>';
  } else {
    $('#morningWorkout').innerHTML = workoutMarkup(plan.morning, 'workoutAM');
    $('#eveningWorkout').innerHTML = workoutMarkup(plan.evening, 'workoutPM');
  }
  $('#waterLiters').textContent = (day.water * CUP_ML / 1000).toFixed(2);
  $('#waterCups').innerHTML = '';
  const cups = Math.min(20, day.water);
  for (let i = 0; i < Math.max(8, cups); i += 1) {
    const cup = document.createElement('span');
    cup.className = `water-cup ${i < cups ? 'filled' : ''}`;
    $('#waterCups').appendChild(cup);
  }
}

function workoutMarkup(session, taskId) {
  const list = session.items.map(([name, amount]) => `<li><b>${escapeHTML(name)}</b><span>${escapeHTML(amount)}</span></li>`).join('');
  const day = ensureDay();
  const complete = Boolean(day.done[taskId]);
  return `<div class="workout-info"><h3>${escapeHTML(session.title)}</h3><p>${escapeHTML(session.focus)}</p><ul class="exercise-list">${list}</ul></div><div class="workout-info"><h3>Protocolo de ejecución</h3><p>Calienta 5–10 minutos, descansa entre series y termina con sensación de que podrías hacer un poco más. La progresión se logra semana a semana, no en un día.</p><p><b>Material permitido:</b> peso corporal y mochila estable. Las pesas caseras deben estar bien fijadas y probarse primero con poco peso.</p><p><b>Recuperación:</b> duerme 8 horas cuando sea posible y evita entrenar fuerte el mismo grupo muscular dos días seguidos.</p></div><div class="workout-footer"><span class="micro-note">${complete ? 'Sesión registrada.' : 'Marca la sesión cuando termines de forma segura.'}</span><button class="button ${complete ? 'button-quiet' : 'button-blue'}" data-workout-check="${taskId}" type="button">${complete ? 'Completado ✓' : 'Marcar sesión completada'}</button></div>`;
}

function renderFace() {
  const container = $('#careChecklist');
  const definitions = [
    { id: 'pillow', title: 'Cambiar funda de almohada', interval: 4 },
    { id: 'towel', title: 'Cambiar / lavar toalla facial', interval: 4 },
    { id: 'hair', title: 'Revisión de cabello, cejas y barba', interval: 7 }
  ];
  container.innerHTML = '';
  definitions.forEach((item) => {
    const last = state.careDates[item.id] ? parseDate(state.careDates[item.id]) : addDays(new Date(), -item.interval);
    const due = Math.max(0, item.interval - Math.floor((new Date() - last) / 86400000));
    const isDue = due === 0;
    const card = document.createElement('div');
    card.className = 'care-item';
    const copy = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = item.title;
    const note = document.createElement('small');
    note.textContent = isDue ? 'Toca realizarlo hoy.' : `Próximo recordatorio en ${due} día(s).`;
    copy.append(title, note);
    const button = document.createElement('button');
    button.className = `button ${isDue ? 'button-pink' : 'button-quiet'}`;
    button.type = 'button';
    button.textContent = 'Hecho hoy';
    button.addEventListener('click', () => {
      state.careDates[item.id] = dateKey();
      saveState();
      renderFace();
      setText('#luxionMessage', 'Higiene registrada. La constancia también se construye con detalles.');
    });
    card.append(copy, button);
    container.appendChild(card);
  });
}

const SYLLABUS = [
  { subject: 'Matemática', topics: ['Aritmética: divisibilidad y números', 'Razones, proporciones y porcentajes', 'Álgebra: productos notables y factorización', 'Ecuaciones e inecuaciones', 'Funciones y gráficas', 'Geometría plana', 'Geometría del espacio', 'Trigonometría', 'Estadística y probabilidad'] },
  { subject: 'Física', topics: ['Magnitudes y análisis dimensional', 'Vectores', 'Cinemática', 'Leyes de Newton', 'Trabajo, energía y potencia', 'Cantidad de movimiento', 'Estática y fluidos', 'Electricidad básica', 'Ondas y óptica'] },
  { subject: 'Química', topics: ['Materia y estructura atómica', 'Tabla periódica', 'Enlace químico', 'Nomenclatura inorgánica', 'Mol y estequiometría', 'Soluciones', 'Reacciones químicas', 'Química orgánica básica'] },
  { subject: 'Comunicación y razonamiento verbal', topics: ['Comprensión lectora', 'Idea principal e inferencias', 'Conectores lógicos', 'Sinónimos y antónimos', 'Analogías', 'Término excluido', 'Plan de redacción', 'Ortografía y puntuación'] },
  { subject: 'Biología', topics: ['Características de los seres vivos', 'Biomoléculas', 'Célula y organelos', 'Genética', 'Evolución', 'Ecología', 'Sistemas del cuerpo humano'] },
  { subject: 'Historia y geografía', topics: ['Historia del Perú: culturas antiguas', 'Virreinato e independencia', 'República peruana', 'Historia universal', 'Geografía física', 'Geografía del Perú', 'Economía y ciudadanía'] }
];

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function renderSyllabus() {
  const list = $('#syllabusList');
  list.innerHTML = '';
  let total = 0;
  let mastered = 0;
  SYLLABUS.forEach((subject, index) => {
    const card = document.createElement('div');
    card.className = 'subject-card';
    const completed = subject.topics.filter((topic) => state.topics[topic] === 'dominado').length;
    total += subject.topics.length;
    mastered += completed;
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'subject-head';
    header.innerHTML = `<strong>${escapeHTML(subject.subject)}</strong><small>${completed}/${subject.topics.length} DOMINADOS　⌄</small>`;
    const topicList = document.createElement('div');
    topicList.className = 'topic-list';
    topicList.hidden = index !== 0;
    subject.topics.forEach((topic) => {
      const row = document.createElement('div');
      row.className = 'topic-row';
      const name = document.createElement('span');
      name.textContent = topic;
      const actions = document.createElement('div');
      actions.className = 'topic-actions';
      const studied = document.createElement('button');
      studied.type = 'button';
      studied.className = `tiny-button studied ${state.topics[topic] === 'estudiado' ? 'selected' : ''}`;
      studied.textContent = 'Estudiado';
      studied.addEventListener('click', () => {
        state.topics[topic] = state.topics[topic] === 'estudiado' ? '' : 'estudiado';
        saveState(); renderSyllabus(); renderProgress();
      });
      const masteredButton = document.createElement('button');
      masteredButton.type = 'button';
      masteredButton.className = `tiny-button ${state.topics[topic] === 'dominado' ? 'selected' : ''}`;
      masteredButton.textContent = 'Dominado';
      masteredButton.addEventListener('click', () => {
        state.topics[topic] = state.topics[topic] === 'dominado' ? 'estudiado' : 'dominado';
        saveState(); renderSyllabus(); renderProgress();
      });
      actions.append(studied, masteredButton);
      row.append(name, actions);
      topicList.appendChild(row);
    });
    header.addEventListener('click', () => { topicList.hidden = !topicList.hidden; });
    card.append(header, topicList);
    list.appendChild(card);
  });
  $('#topicProgress').textContent = `${total ? Math.round(mastered / total * 100) : 0}% DOMINADO`;
}

function renderScores() {
  const chart = $('#scoreChart');
  chart.innerHTML = '';
  const scores = state.scores.slice(-8);
  if (!scores.length) {
    chart.innerHTML = '<p class="micro-note">Aún no hay puntajes. Guarda el primero después de un simulacro.</p>';
    return;
  }
  const maximum = Math.max(100, ...scores.map((score) => score.value));
  scores.forEach((score) => {
    const bar = document.createElement('div');
    bar.className = 'score-bar';
    bar.style.height = `${Math.max(5, score.value / maximum * 90)}px`;
    const value = document.createElement('span');
    value.textContent = score.value;
    const date = document.createElement('small');
    date.textContent = score.date.slice(5);
    bar.append(value, date);
    chart.appendChild(bar);
  });
}

function renderProgress() {
  const won = Object.keys(state.days).filter((key) => getDayProgress(key).won).length;
  $('#wonDays').textContent = won;
  $('#resolvedPenalties').textContent = getResolvedPenalties().length;
  $('#masteredTopics').textContent = Object.values(state.topics).filter((value) => value === 'dominado').length;
  $('#progressStreakHero').textContent = `${calculateStreak()} DÍAS`;

  const calendar = $('#calendarGrid');
  calendar.innerHTML = '';
  const today = new Date();
  const first = addDays(today, -34);
  for (let i = 0; i < 35; i += 1) {
    const date = addDays(first, i);
    const key = dateKey(date);
    const day = state.days[key];
    const cell = document.createElement('div');
    cell.className = 'calendar-day';
    if (key === dateKey()) cell.classList.add('today');
    if (day) {
      if (getDayProgress(key).won) cell.classList.add('won');
      else if (day.closed || Object.keys(day.missed || {}).length || day.violations?.length) cell.classList.add('missed');
    }
    const number = document.createElement('span');
    number.textContent = date.getDate();
    const weekday = document.createElement('small');
    weekday.textContent = ['D', 'L', 'M', 'X', 'J', 'V', 'S'][date.getDay()];
    cell.append(number, weekday);
    calendar.appendChild(cell);
  }

  const penaltyContainer = $('#penaltyList');
  penaltyContainer.innerHTML = '';
  const open = getOpenPenalties();
  if (!open.length) {
    penaltyContainer.innerHTML = '<p class="micro-note">No hay penalizaciones pendientes. Mantén el estándar.</p>';
  } else {
    open.forEach((penalty) => {
      const item = document.createElement('div');
      item.className = 'penalty-item';
      const title = document.createElement('strong'); title.textContent = penalty.title;
      const detail = document.createElement('small'); detail.textContent = `${penalty.detail} Fecha de revisión: ${penalty.due}.`;
      const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-outline'; button.textContent = 'Marcar reparación superada';
      button.addEventListener('click', () => {
        const ok = confirm('¿Completaste la revisión y el bloque correctivo razonable? No añadas ejercicio extra ni reduzcas horas de sueño.');
        if (!ok) return;
        penalty.resolved = true;
        penalty.resolution = 'Revisión confirmada por el usuario.';
        saveState(); renderAll();
      });
      item.append(title, detail, button);
      penaltyContainer.appendChild(item);
    });
  }
  renderScores();
}

function renderJournal() {
  const day = ensureDay();
  const progress = getDayProgress();
  const unlocked = progress.won || new Date().getHours() * 60 + new Date().getMinutes() >= 21 * 60 + 15;
  $('#journalLock').textContent = unlocked ? 'DESBLOQUEADO' : 'BLOQUEADO';
  $('#journalLock').className = `neon-tag ${unlocked ? 'green' : 'yellow'}`;
  $('#journalText').disabled = !unlocked;
  $('#closeDay').disabled = !unlocked;
  if (document.activeElement !== $('#journalText') && $('#journalText').value !== (day.journal || '')) {
    $('#journalText').value = day.journal || '';
  }
  $('#journalHint').textContent = unlocked ? 'Puedes escribir una reflexión y cerrar el día. Si faltan tareas, el día no contará como ganado.' : 'Se desbloquea al completar el 100% de las tareas o desde las 9:15 p. m.';
}

function renderAll() {
  ensureDay();
  renderCountdown();
  renderSchedule();
  renderPhysical();
  renderFace();
  renderSyllabus();
  renderProgress();
  renderJournal();
  updateConnectionStatus();
  updateDriveStatus();
}

function addWater(amount) {
  const day = ensureDay();
  day.water = Math.max(0, Math.min(30, day.water + amount));
  saveState();
  renderPhysical();
}

function showLuxionMessage(message) {
  setText('#luxionMessage', message);
}

function beepSequence() {
  if (!alertAudioContext) return;
  const playOne = (index) => {
    if (index >= 3) return;
    const oscillator = alertAudioContext.createOscillator();
    const gain = alertAudioContext.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = index === 1 ? 880 : 660;
    gain.gain.setValueAtTime(0.001, alertAudioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, alertAudioContext.currentTime + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, alertAudioContext.currentTime + 0.22);
    oscillator.connect(gain); gain.connect(alertAudioContext.destination);
    oscillator.start(); oscillator.stop(alertAudioContext.currentTime + 0.23);
    window.setTimeout(() => playOne(index + 1), 330);
  };
  playOne(0);
}

async function notifyUser(title, body) {
  if (state.settings.alertsEnabled && 'Notification' in window && Notification.permission === 'granted') {
    try {
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration) await registration.showNotification(title, { body, icon: './icon-192.png', badge: './icon-192.png', tag: `luxion-${Date.now()}`, renotify: true });
      else new Notification(title, { body });
    } catch (error) { console.warn('No se pudo mostrar la notificación:', error); }
  }
  if (!document.hidden) beepSequence();
}

async function enableAlerts() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && !alertAudioContext) alertAudioContext = new AudioContextClass();
    if (alertAudioContext?.state === 'suspended') await alertAudioContext.resume();
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') setText('#alertStatus', 'No autorizaste notificaciones. El sonido funcionará con la app abierta.');
    } else {
      setText('#alertStatus', 'Este navegador no ofrece notificaciones. El temporizador seguirá funcionando en pantalla.');
    }
    state.settings.alertsEnabled = true;
    saveState(false);
    setText('#alertStatus', 'Alertas activadas. Mantén LUXION abierta para los sonidos y avisos puntuales.');
    $('#enableAlerts').textContent = 'Alertas activadas';
    await notifyUser('LUXION activado', 'Las alertas están listas mientras la app se mantenga activa.');
  } catch (error) {
    setText('#alertStatus', 'No fue posible activar el sonido en este navegador.');
  }
}

function alertKey(type, blockId, key = dateKey()) {
  return `luxion-alert-${key}-${type}-${blockId}`;
}

function checkScheduleAlerts() {
  const now = new Date();
  const minute = now.getHours() * 60 + now.getMinutes();
  const key = dateKey();
  const blocks = getBlocksForDate(key);
  blocks.forEach((block) => {
    if (minute === toMinutes(block.start) && now.getSeconds() < 25 && !sessionStorage.getItem(alertKey('start', block.id, key))) {
      sessionStorage.setItem(alertKey('start', block.id, key), '1');
      notifyUser('LUXION · Inicia el bloque', `${block.title}. Ejecuta el plan ahora.`);
      if (['workoutAM', 'workoutPM'].includes(block.id)) showLuxionMessage('Entrena con técnica. La disciplina también es saber cuándo recuperar.');
      else if (block.id === 'study') showLuxionMessage('Cierra el cuaderno, recuerda y luego comprueba. No estudies en piloto automático.');
    }
    if (minute === toMinutes(block.end) && now.getSeconds() < 25 && !sessionStorage.getItem(alertKey('end', block.id, key))) {
      sessionStorage.setItem(alertKey('end', block.id, key), '1');
      notifyUser('LUXION · Bloque terminado', `Cierra: ${block.title}. Pasa al siguiente bloque.`);
    }
  });

  // Aviso preventivo 20:45. La rutina fija no se desplaza sobre la hora de dormir.
  const day = ensureDay(key);
  if (minute >= 20 * 60 + 45 && minute < 21 * 60 + 15 && !day.nightPrompted) {
    day.nightPrompted = true;
    saveState(false);
    notifyUser('LUXION · Plan de mañana', '¿Hay trabajo imprevisto para mañana? Revisa el protocolo excepcional antes de las 9:15 p. m.');
    if (!document.hidden) {
      const yes = confirm('LUXION: ¿Mañana tendrás trabajo imprevisto que impida cumplir el horario normal?\n\nAceptar activa el protocolo excepcional para mañana (si aún tienes usos disponibles). La hora de dormir no cambia.');
      if (yes) activateEmergency(dateKey(addDays(now, 1)));
    }
  }
  if (minute === 21 * 60 + 45 && now.getSeconds() < 25 && !sessionStorage.getItem(alertKey('sleep-warning', 'sleep', key))) {
    sessionStorage.setItem(alertKey('sleep-warning', 'sleep', key), '1');
    notifyUser('LUXION · Cierre', 'Termina el diario. Apaga pantallas y prepárate para dormir a las 10:00 p. m.');
  }
}

async function toggleWakeLock() {
  if (!('wakeLock' in navigator)) {
    alert('Este navegador no permite mantener la pantalla encendida desde una PWA.');
    return;
  }
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
    state.settings.keepAwake = false;
    $('#wakeButton').textContent = 'Mantener pantalla encendida: OFF';
  } else {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      state.settings.keepAwake = true;
      $('#wakeButton').textContent = 'Mantener pantalla encendida: ON';
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        // El sistema puede liberar el bloqueo al ocultar la app. Conservamos la
        // preferencia para volver a solicitarlo cuando el usuario regrese.
        if (!state.settings.keepAwake) {
          $('#wakeButton').textContent = 'Mantener pantalla encendida: OFF';
          saveState(false);
        }
      });
    } catch (error) {
      alert('El sistema no permitió mantener la pantalla encendida (por batería baja, ahorro de energía o configuración).');
    }
  }
  saveState(false);
}

async function restoreWakeLockIfNeeded() {
  if (state.settings.keepAwake && document.visibilityState === 'visible' && 'wakeLock' in navigator && !wakeLock) {
    try { wakeLock = await navigator.wakeLock.request('screen'); $('#wakeButton').textContent = 'Mantener pantalla encendida: ON'; }
    catch (error) { state.settings.keepAwake = false; $('#wakeButton').textContent = 'Mantener pantalla encendida: OFF'; }
  }
}

function activateTab(tab) {
  activeTab = tab;
  $$('.view').forEach((view) => view.classList.toggle('active', view.dataset.view === tab));
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (tab === 'progreso') renderProgress();
}

function reportViolation() {
  $('#violationDialog').showModal();
}

function confirmViolation() {
  const type = $('#violationType').value;
  const note = $('#violationNote').value.trim();
  const penalty = createPenalty('Reparación por infracción', `${type} ${note ? `Detalle: ${note}` : ''} Repara con 10 minutos de reflexión y un bloque de 25 minutos de estudio/planificación. No se recortan sueño, comidas ni recuperación física.`, 'infracción');
  ensureDay().violations.push(penalty.id);
  $('#violationDialog').close();
  $('#violationNote').value = '';
  saveState(); renderAll();
  showLuxionMessage('Infracción registrada. Asume la responsabilidad, completa la reparación y vuelve al plan.');
}

function openDriveDialog() {
  $('#driveUrl').value = state.drive.url || '';
  $('#driveKey').value = state.drive.key || '';
  $('#driveDialog').showModal();
}

function saveDriveSettings() {
  const url = $('#driveUrl').value.trim();
  const key = $('#driveKey').value.trim();
  if (url && (!url.startsWith('https://script.google.com/macros/s/') || !url.endsWith('/exec'))) {
    alert('La dirección debe empezar por https://script.google.com/macros/s/ y terminar en /exec.');
    return;
  }
  if (url && key.length < 8) {
    alert('La clave debe tener al menos 8 caracteres. Usa la misma clave que configuraste en Apps Script.');
    return;
  }
  state.drive.url = url;
  state.drive.key = key;
  $('#driveDialog').close();
  saveState(false);
  updateDriveStatus();
  if (url) syncDriveNow();
}

function updateDriveStatus() {
  const status = $('#backupStatus');
  if (!status) return;
  if (!state.drive.url || !state.drive.key) status.textContent = 'Copia local activa. Google Drive todavía no está configurado.';
  else if (!navigator.onLine) status.textContent = 'Drive configurado. Sin internet: la copia queda guardada localmente y se intentará enviar al volver la conexión.';
  else status.textContent = state.drive.lastSent ? `Último envío solicitado: ${state.drive.lastSent}. Verifica que LUXION_BACKUP.json se actualizó en Drive.` : 'Drive configurado. Se intentará enviar la copia al guardar cambios.';
}

function buildBackupObject() {
  const cleanState = JSON.parse(JSON.stringify(state));
  delete cleanState.drive; // La dirección y clave no se incluyen al exportar un archivo.
  return {
    application: 'LUXION',
    backupVersion: 1,
    exportedAt: new Date().toISOString(),
    data: cleanState
  };
}

function downloadBackup() {
  const payload = JSON.stringify(buildBackupObject(), null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `LUXION_backup_${dateKey()}.json`;
  document.body.appendChild(link); link.click(); link.remove();
  URL.revokeObjectURL(url);
  setText('#backupStatus', 'Copia descargada. Guárdala también en un lugar seguro.');
}

function restoreBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const payload = JSON.parse(String(reader.result));
      if (payload.application !== 'LUXION' || !payload.data || typeof payload.data !== 'object') throw new Error('Formato no reconocido.');
      const confirmRestore = confirm('Restaurar esta copia reemplazará los registros actuales de LUXION en este dispositivo. ¿Continuar?');
      if (!confirmRestore) return;
      const currentDrive = state.drive;
      state = { ...freshState(), ...payload.data, drive: currentDrive };
      saveState(); renderAll();
      setText('#backupStatus', 'Copia restaurada en este dispositivo.');
    } catch (error) {
      alert(`No se pudo restaurar la copia: ${error.message}`);
    }
  };
  reader.readAsText(file);
}

function queueDriveSync() {
  if (!state.drive.url || !state.drive.key || !navigator.onLine) return;
  window.clearTimeout(saveSyncTimer);
  saveSyncTimer = window.setTimeout(() => syncDriveNow(), 2500);
}

function syncDriveNow() {
  if (!navigator.onLine || !state.drive.url || !state.drive.key) {
    updateDriveStatus();
    return;
  }
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = state.drive.url;
  form.target = 'luxionBackupFrame';
  form.enctype = 'application/x-www-form-urlencoded';
  form.style.display = 'none';
  const keyInput = document.createElement('input');
  keyInput.name = 'key'; keyInput.value = state.drive.key;
  const payloadInput = document.createElement('input');
  payloadInput.name = 'payload'; payloadInput.value = JSON.stringify(buildBackupObject());
  form.append(keyInput, payloadInput);
  document.body.appendChild(form);
  form.submit();
  window.setTimeout(() => form.remove(), 3000);
  state.drive.lastSent = new Date().toLocaleString('es-PE');
  saveState(false);
  updateDriveStatus();
}

function saveJournalAndClose() {
  const day = ensureDay();
  const progress = getDayProgress();
  const unlock = progress.won || new Date().getHours() * 60 + new Date().getMinutes() >= 21 * 60 + 15;
  if (!unlock) return;
  day.journal = $('#journalText').value.trim();
  day.done.journal = true;
  resolveTaskPenalty(dateKey(), 'journal');
  day.closed = true;
  const finalProgress = getDayProgress();
  saveState();
  renderAll();
  $('#closeDayStatus').textContent = finalProgress.won ? 'Día cerrado: 100% completado y registrado.' : 'Día cerrado con tareas pendientes. No cuenta como día ganado; revisa la lista de reparación.';
  showLuxionMessage(finalProgress.won ? 'Día cerrado y ganado. Mañana se repite el estándar.' : 'Cierre registrado. Revisa los pendientes y retoma el plan sin castigarte físicamente.');
  syncDriveNow();
}

function startExamTimer() {
  if (examRunning) return;
  const minutes = Math.max(15, Math.min(300, Number($('#examMinutes').value) || 180));
  if (!examInterval && examRemaining === 180 * 60) examRemaining = minutes * 60;
  examRunning = true;
  examInterval = window.setInterval(() => {
    examRemaining = Math.max(0, examRemaining - 1);
    $('#examClock').textContent = formatDuration(examRemaining);
    if (examRemaining <= 0) {
      pauseExamTimer();
      notifyUser('LUXION · Simulacro terminado', 'Detén el examen y registra el puntaje.');
      showLuxionMessage('Simulacro terminado. Analiza tus errores: ahí está el siguiente avance.');
    }
  }, 1000);
}

function pauseExamTimer() {
  if (examInterval) window.clearInterval(examInterval);
  examInterval = null;
  examRunning = false;
}

function resetExamTimer() {
  pauseExamTimer();
  const minutes = Math.max(15, Math.min(300, Number($('#examMinutes').value) || 180));
  examRemaining = minutes * 60;
  $('#examClock').textContent = formatDuration(examRemaining);
}

function saveExamScore() {
  const value = Number($('#examScore').value);
  if (!Number.isFinite(value) || value < 0 || value > 1000) {
    alert('Introduce un puntaje entre 0 y 1000.');
    return;
  }
  state.scores.push({ value, date: dateKey() });
  state.scores.sort((a, b) => a.date.localeCompare(b.date));
  saveState();
  renderScores();
  $('#examScore').value = '';
  showLuxionMessage('Puntaje registrado. Compara tendencias y analiza los errores, no solo la cifra.');
}

function maybeRegisterServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').then(() => {
    console.log('LUXION: modo offline preparado.');
  }).catch((error) => console.warn('No se pudo activar el modo offline:', error));
}

function setupInstallPrompt() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPromptEvent = event;
    $('#installButton').hidden = false;
  });
  $('#installButton').addEventListener('click', async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice;
    installPromptEvent = null;
    $('#installButton').hidden = true;
  });
}

function maybeShowOfflineHint() {
  if (!navigator.onLine) showLuxionMessage('Estás sin conexión. Tu horario y tus registros siguen disponibles en este dispositivo.');
}

function attachEvents() {
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)));
  $('#enableAlerts').addEventListener('click', enableAlerts);
  $('#wakeButton').addEventListener('click', toggleWakeLock);
  $('#reportViolation').addEventListener('click', reportViolation);
  $('#confirmViolation').addEventListener('click', confirmViolation);
  $('#emergencyButton').addEventListener('click', () => activateEmergency());
  $('#downloadBackup').addEventListener('click', downloadBackup);
  $('#restoreFile').addEventListener('change', (event) => restoreBackup(event.target.files[0]));
  $('#openDriveSettings').addEventListener('click', openDriveDialog);
  $('#saveDriveConfig').addEventListener('click', saveDriveSettings);
  $('#addWater').addEventListener('click', () => addWater(1));
  $('#removeWater').addEventListener('click', () => addWater(-1));
  $$('[data-face-check]').forEach((button) => button.addEventListener('click', () => {
    const id = button.dataset.faceCheck === 'am' ? 'wake' : 'facePM';
    markTask(id, true);
    button.textContent = 'Rutina registrada ✓';
  }));
  $('#morningWorkout').addEventListener('click', (event) => {
    const button = event.target.closest('[data-workout-check]');
    if (button) markTask(button.dataset.workoutCheck, true);
  });
  $('#eveningWorkout').addEventListener('click', (event) => {
    const button = event.target.closest('[data-workout-check]');
    if (button) markTask(button.dataset.workoutCheck, true);
  });
  $('#journalText').addEventListener('input', () => {
    ensureDay().journal = $('#journalText').value;
    saveState(false);
  });
  $('#closeDay').addEventListener('click', saveJournalAndClose);
  $('#startExam').addEventListener('click', startExamTimer);
  $('#pauseExam').addEventListener('click', pauseExamTimer);
  $('#resetExam').addEventListener('click', resetExamTimer);
  $('#examMinutes').addEventListener('change', resetExamTimer);
  $('#saveScore').addEventListener('click', saveExamScore);
  window.addEventListener('online', () => { updateConnectionStatus(); updateDriveStatus(); syncDriveNow(); });
  window.addEventListener('offline', () => { updateConnectionStatus(); updateDriveStatus(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') restoreWakeLockIfNeeded();
    else if (wakeLock) {
      const currentLock = wakeLock;
      wakeLock = null;
      currentLock.release().catch(() => {});
    }
  });
}

function init() {
  ensureDay();
  attachEvents();
  maybeRegisterServiceWorker();
  setupInstallPrompt();
  renderAll();
  resetExamTimer();
  maybeShowOfflineHint();
  processOverdueTasks();
  setInterval(() => {
    renderCountdown();
    renderSchedule();
    renderJournal();
    checkScheduleAlerts();
    processOverdueTasks();
  }, 1000);
  setInterval(() => {
    if (navigator.onLine && state.drive.url && Date.now() - lastAutoSync > 5 * 60 * 1000) {
      lastAutoSync = Date.now();
      syncDriveNow();
    }
  }, 60 * 1000);
  if (state.settings.alertsEnabled) $('#enableAlerts').textContent = 'Alertas activadas';
  if (state.settings.keepAwake) $('#wakeButton').textContent = 'Mantener pantalla encendida: ON';
  updateDriveStatus();
}

document.addEventListener('DOMContentLoaded', init);
