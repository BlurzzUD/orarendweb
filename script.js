'use strict';

/* ===== 1. KONFIGURÁCIÓ =====
   Új osztály: tedd a JSON-t a data/ mappába, és vegyél fel ide egy sort.
   A többi kódhoz nem kell nyúlni. */
const CLASSES = [
  { id: '11A', name: '11. A', file: 'data/11A_timetable.json' },
];
const STORAGE_KEY = 'orarend.beallitasok';
const DAYS = ['hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat', 'vasárnap'];
const MONTHS = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];

const cache = new Map(); // betöltött osztályadatok (csak memóriában)
const state = { cls: null, data: null, groups: [], day: null };
const $ = id => document.getElementById(id);

/* ===== 2. SEGÉDFÜGGVÉNYEK ===== */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.filter(Boolean));
  return n;
}
const norm = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const pad = n => String(n).padStart(2, '0');
const toMin = t => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? +m[1] * 60 + +m[2] : NaN; };
const safeColor = c => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c || '') ? c : '#e3e7f2';

/* Olvasható szövegszín: a nagyobb kontrasztú (sötét vagy fehér) nyer. */
function inkFor(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = [...h].map(x => x + x).join('');
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.substr(i, 2), 16) / 255)
    .map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  const L = .2126 * r + .7152 * g + .0722 * b + .05;
  return L / .06 > 1.05 / L ? '#141a2e' : '#ffffff';
}

const parseDate = s => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? { y: +m[1], m: +m[2], d: +m[3] } : null; };
const addDays = (a, n) => new Date(Date.UTC(a.y, a.m - 1, a.d + n));

function formatWeek(w) {
  const a = parseDate(w?.from), b = parseDate(w?.to);
  if (!a) return '';
  const left = `${a.y}. ${MONTHS[a.m - 1]} ${a.d}.`;
  if (!b) return left;
  const right = (b.y !== a.y ? `${b.y}. ` : '') + (b.y !== a.y || b.m !== a.m ? `${MONTHS[b.m - 1]} ` : '') + `${b.d}.`;
  return `${left} – ${right}`;
}
function dayLabel(week, offset) {
  const a = parseDate(week?.from);
  if (!a) return '';
  const d = addDays(a, offset);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}.`;
}

/* ===== 3. OSZTÁLYOK ÉS JSON BETÖLTÉSE ===== */
const getAvailableClasses = () => CLASSES;

async function loadClassData(cls) {
  if (cache.has(cls.id)) return cache.get(cls.id);
  let res;
  try { res = await fetch(cls.file, { cache: 'no-cache' }); }
  catch {
    throw new Error('Az órarend betöltése nem sikerült.' + (location.protocol === 'file:' ? ' Helyi fájlként nem működik – indíts webszervert (pl. python3 -m http.server).' : ''));
  }
  if (!res.ok) throw new Error(`Az órarend betöltése nem sikerült (${res.status}).`);
  let raw;
  try { raw = await res.json(); }
  catch { throw new Error('Az órarend fájlja hibás, nem olvasható JSON.'); }
  const data = parseTimetable(raw, cls);
  cache.set(cls.id, data);
  return data;
}

/* ===== 4. ADATOK ELEMZÉSE (JSON → belső modell) ===== */
function parseTimetable(raw, cls) {
  if (!raw || typeof raw.timetable !== 'object' || !raw.timetable || typeof raw.periods !== 'object' || !raw.periods)
    throw new Error('Az órarend adatai hiányosak.');
  const periods = Object.entries(raw.periods)
    .map(([key, p]) => ({ key, no: p?.name ?? key, start: p?.start, end: p?.end, s: toMin(p?.start), e: toMin(p?.end) }))
    .filter(p => !isNaN(p.s) && !isNaN(p.e))
    .sort((a, b) => a.s - b.s);
  if (!periods.length) throw new Error('Az órarendben nincsenek tanórák időpontjai.');

  const warnings = [], days = [];
  Object.entries(raw.timetable).forEach(([dayKey, buckets], pos) => {
    const name = dayKey.replace(/\s*\(.*\)\s*$/, '').trim() || dayKey;
    const known = DAYS.findIndex(d => norm(dayKey).startsWith(norm(d).slice(0, 3)));
    const lessons = [];
    for (const [bucket, list] of Object.entries(buckets || {})) {
      for (const l of Array.isArray(list) ? list : []) {
        try {
          const num = (/(\d+)/.exec(bucket) || [])[1];
          let first = periods.findIndex(p => p.s === toMin(l.start));
          if (first < 0) first = periods.findIndex(p => String(p.no) === num || p.key === num); // tartalék: "Period N" kulcs
          if (!l.subject || first < 0) throw new Error('hibás óra');
          const span = Math.min(Math.max(parseInt(l.duration_periods) || 1, 1), periods.length - first);
          lessons.push({
            subject: String(l.subject), teacher: l.teacher || '', room: l.room || '',
            groups: Array.isArray(l.groups) ? l.groups.filter(Boolean).map(String) : [],
            first, span, color: safeColor(l.color),
            start: l.start || periods[first].start, end: l.end || periods[first + span - 1].end,
          });
        } catch { warnings.push(`${name}: hibás óra kihagyva`); }
      }
    }
    days.push({ name, offset: known >= 0 ? known : pos, lessons });
  });
  days.sort((a, b) => a.offset - b.offset);
  return { cls, className: raw.class || cls.name, classId: raw.class_id, week: raw.week || {}, periods, days, warnings };
}

/* ===== 5. CSOPORTOK ÉS SZŰRÉS ===== */
const getAvailableGroups = data =>
  [...new Set(data.days.flatMap(d => d.lessons.flatMap(l => l.groups)))]
    .sort((a, b) => a.localeCompare(b, 'hu', { numeric: true }));

/* Üres groups = egész osztály (mindig látszik); egyébként legalább egy egyező csoport kell. */
function filterLessonsByGroups(lessons, selected) {
  const sel = new Set(selected);
  return lessons.filter(l => !l.groups.length || l.groups.some(g => sel.has(g)));
}

/* Átfedő órák egy cellába kerülnek, így a rowspan mindig helyes. */
function clusterLessons(lessons) {
  const out = [];
  for (const l of [...lessons].sort((a, b) => a.first - b.first || b.span - a.span)) {
    const c = out[out.length - 1];
    if (c && l.first < c.end) { c.lessons.push(l); c.end = Math.max(c.end, l.first + l.span); }
    else out.push({ first: l.first, end: l.first + l.span, lessons: [l] });
  }
  return out;
}

/* ===== 6. ÓRAREND-TÁBLÁZAT ===== */
function paint(node, l) {
  node.classList.add('colored');
  node.style.setProperty('--c', l.color);
  node.style.setProperty('--ink', inkFor(l.color));
}
const lessonBody = l => [
  el('strong', { class: 'subj', text: l.subject }),
  (l.teacher || l.room) && el('span', { class: 'meta' },
    l.teacher && el('span', { class: 'tch', text: l.teacher }),
    l.room && el('span', { class: 'rm', text: l.room })),
  l.groups.length > 0 && el('span', { class: 'grp', text: l.groups.join(', ') }),
  l.span > 1 && el('span', { class: 'when', text: `${l.start}–${l.end}` }),
].filter(Boolean);

function lessonCell(c, day) {
  const span = c.end - c.first;
  const td = el('td', { class: 'slot', 'data-day': day, rowspan: span > 1 ? span : null });
  if (c.lessons.length === 1) {
    paint(td, c.lessons[0]);
    td.append(...lessonBody(c.lessons[0]));
  } else {
    td.classList.add('multi');
    for (const l of c.lessons) {
      const box = el('div', { class: 'lesson' });
      paint(box, l);
      box.append(...lessonBody(l));
      td.append(box);
    }
  }
  return td;
}

function buildTimetable(data, selected) {
  const cols = data.days.map(d => ({ ...d, clusters: clusterLessons(filterLessonsByGroups(d.lessons, selected)) }));
  const all = cols.flatMap(d => d.clusters);
  if (!all.length) return el('p', { class: 'notice', text: 'Ehhez a beállításhoz nem tartozik megjeleníthető óra.' });
  const from = Math.min(...all.map(c => c.first)), to = Math.max(...all.map(c => c.end));

  const table = el('table', { class: 'tt' });
  table.append(
    el('caption', {}, el('strong', { text: `${data.className} – személyes órarend` }), el('span', { text: formatWeek(data.week) })),
    el('colgroup', {}, el('col', { class: 'c-no' }), el('col', { class: 'c-time' }), ...cols.map(() => el('col'))),
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col', colspan: 2, text: 'Óra' }),
      ...cols.map((d, i) => el('th', { scope: 'col', 'data-day': i }, d.name, el('span', { text: dayLabel(data.week, d.offset) }))))),
  );

  const tbody = el('tbody'), busy = cols.map(() => 0); // busy[i]: meddig foglalja a nap oszlopát egy rowspan
  for (let r = from; r < to; r++) {
    const p = data.periods[r];
    const tr = el('tr', {}, el('th', { scope: 'row', class: 'pno', text: `${p.no}.` }), el('td', { class: 'time', text: `${p.start}–${p.end}` }));
    cols.forEach((d, i) => {
      if (r < busy[i]) return; // egy fentről érkező rowspan lefedi
      const c = d.clusters.find(x => x.first === r);
      if (!c) return tr.append(el('td', { class: 'empty', 'data-day': i }));
      busy[i] = c.end;
      tr.append(lessonCell(c, i));
    });
    tbody.append(tr);
  }
  table.append(tbody);

  const counts = cols.map(d => d.clusters.reduce((s, c) => s + c.end - c.first, 0));
  table.append(el('tfoot', {},
    el('tr', {}, el('th', { scope: 'row', colspan: 2, text: 'Napi óraszám' }), ...counts.map((n, i) => el('td', { 'data-day': i, text: `${n} óra` }))),
    el('tr', {}, el('td', { colspan: cols.length + 2, text: selected.length ? `Csoportjaid: ${selected.join(', ')}` : 'Nem választottál csoportot, ezért csak az egész osztályos órák látszanak.' }))));
  return table;
}

/* ===== 7. BEÁLLÍTÁSOK MENTÉSE (csak a választás, nem az órarend) ===== */
function savePreferences(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ classId: p.classId, groups: p.groups })); } catch { /* privát mód */ }
}
function loadPreferences() {
  try {
    const p = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return p && typeof p.classId === 'string' && Array.isArray(p.groups) ? p : null;
  } catch { return null; }
}
function clearPreferences() { try { localStorage.removeItem(STORAGE_KEY); } catch { /* nincs teendő */ } }

/* ===== 8. ICS NAPTÁR ===== */
const icsEsc = s => String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
function icsFold(line) { // max. 75 bájtos sorok (UTF-8)
  const enc = new TextEncoder();
  let out = '', len = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (len + b > 74) { out += '\r\n '; len = 1; }
    out += ch; len += b;
  }
  return out;
}
const stamp = (dt, hhmm) => {
  const [h, m] = hhmm.split(':');
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(h)}${pad(m)}00`;
};

function generateICS(data, selected) {
  const a = parseDate(data.week.from);
  if (!a) throw new Error('Az órarendhez nem tartozik érvényes kezdődátum.');
  const now = new Date().toISOString().replace(/[-:]|\.\d+/g, '');
  const out = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Orarend//HU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', `X-WR-CALNAME:${icsEsc(`Órarend – ${data.className}`)}`];
  let n = 0;
  for (const d of data.days) {
    const date = addDays(a, d.offset); // hétfő = week.from, kedd = +1 nap, ...
    for (const l of filterLessonsByGroups(d.lessons, selected)) { // ugyanaz a szűrés, mint a táblázatnál
      if (isNaN(toMin(l.start)) || isNaN(toMin(l.end))) continue;
      const desc = [l.teacher && `Tanár: ${l.teacher}`, l.room && `Terem: ${l.room}`, l.groups.length && `Csoport: ${l.groups.join(', ')}`, `Osztály: ${data.className}`].filter(Boolean).join('\n');
      out.push('BEGIN:VEVENT', `UID:${data.cls.id}-${stamp(date, l.start)}-${++n}@orarend`, `DTSTAMP:${now}`,
        `DTSTART:${stamp(date, l.start)}`, `DTEND:${stamp(date, l.end)}`, `SUMMARY:${icsEsc(l.subject)}`,
        ...(l.room ? [`LOCATION:${icsEsc(l.room)}`] : []), `DESCRIPTION:${icsEsc(desc)}`, 'END:VEVENT');
    }
  }
  if (!n) throw new Error('Nincs olyan óra, amit a naptárba lehetne tenni.');
  out.push('END:VCALENDAR');
  return out.map(icsFold).join('\r\n') + '\r\n';
}

function downloadICS() {
  try {
    const text = generateICS(state.data, state.groups);
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar;charset=utf-8' }));
    const a = el('a', { href: url, download: `orarend-${state.cls.id}.ics` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say('A naptárfájl letöltve.');
  } catch (e) { say(e.message || 'A naptár létrehozása nem sikerült.'); }
}

/* ===== 9. FELÜLET: ÓRAREND, BEÁLLÍTÓ ABLAK ===== */
let sayTimer;
function say(msg) {
  $('status').textContent = msg;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(() => { $('status').textContent = ''; }, 5000);
}
const defaultDay = data => Math.max(0, data.days.findIndex(d => d.offset === (new Date().getDay() + 6) % 7));

function setDay(i) { // mobilon csak a kiválasztott nap oszlopa látszik
  state.day = i;
  document.querySelectorAll('#app [data-day]').forEach(n => n.classList.toggle('is-off', +n.dataset.day !== i));
  document.querySelectorAll('#dayTabs button').forEach((b, k) => b.setAttribute('aria-pressed', k === i));
}

function render() {
  const { data, groups } = state;
  document.title = `Órarend – ${data.className}`;
  $('title').textContent = `${data.className} órarend`;
  $('weekInfo').textContent = formatWeek(data.week);
  $('dayTabs').replaceChildren(...data.days.map((d, i) => el('button', { type: 'button', text: d.name, onclick: () => setDay(i) })));
  let table;
  try { table = buildTimetable(data, groups); }
  catch { table = el('p', { class: 'notice', text: 'Az órarend megjelenítése nem sikerült.' }); }
  const warn = data.warnings.length && el('p', { class: 'notice', text: `${data.warnings.length} hibás óra kihagyva az órarendből.` });
  $('app').replaceChildren(...[warn, el('div', { class: 'tt-wrap' }, table)].filter(Boolean));
  setDay(state.day ?? defaultDay(data));
}

function setButtons({ cancel, back, ok }) {
  $('setupCancel').hidden = !cancel; $('setupBack').hidden = !back; $('setupOk').hidden = !ok;
}

/* 1. lépés: osztály */
function renderClassStep(first, error = '') {
  $('setupTitle').textContent = first ? 'Üdv az Órarendben!' : 'Beállítások';
  $('setupText').textContent = first ? 'Először válaszd ki az osztályodat.' : 'Válaszd ki az osztályodat, majd a csoportjaidat.';
  $('setupBody').replaceChildren(el('div', { class: 'choices' }, ...getAvailableClasses().map(c =>
    el('button', { type: 'button', class: 'choice', text: c.name, 'aria-current': state.cls?.id === c.id ? 'true' : null, onclick: () => pickClass(c) }))));
  $('setupError').textContent = error;
  setButtons({ cancel: !!state.data });
  if (!$('setup').open) $('setup').showModal();
}

async function pickClass(cls) {
  $('setupError').textContent = '';
  $('setupBody').setAttribute('aria-busy', 'true');
  try {
    const data = await loadClassData(cls);
    const saved = loadPreferences();
    const keep = state.cls?.id === cls.id ? state.groups : saved?.classId === cls.id ? saved.groups : [];
    renderGroupStep(cls, data, keep);
  } catch (e) { $('setupError').textContent = e.message; }
  finally { $('setupBody').removeAttribute('aria-busy'); }
}

/* 2. lépés: csoportok (a JSON-ból felderítve) */
function renderGroupStep(cls, data, keep) {
  const groups = getAvailableGroups(data);
  $('setupText').textContent = groups.length ? `${data.className} – jelöld be azokat a csoportokat, amelyekbe tartozol.` : `${data.className} – ennél az osztálynál nincsenek külön csoportok.`;
  const fs = el('fieldset', {}, el('legend', { text: 'Válaszd ki a csoportjaidat' }),
    ...groups.map(g => el('label', { class: 'check' }, el('input', { type: 'checkbox', value: g, checked: keep.includes(g) }), el('span', { text: g }))));
  $('setupBody').replaceChildren(fs);
  setButtons({ cancel: !!state.data, back: true, ok: true });
  $('setupBack').onclick = () => renderClassStep(!state.data);
  $('setupOk').onclick = () => applySelection(cls, data, [...fs.querySelectorAll('input:checked')].map(i => i.value));
}

function applySelection(cls, data, groups) {
  Object.assign(state, { cls, data, groups, day: null });
  savePreferences({ classId: cls.id, groups });
  $('setup').close();
  render();
}

/* ===== 10. INDÍTÁS ===== */
async function init() {
  $('btnIcs').onclick = downloadICS;
  $('btnSettings').onclick = () => renderClassStep(false);
  $('setupCancel').onclick = () => $('setup').close();
  $('setup').addEventListener('cancel', e => { if (!state.data) e.preventDefault(); }); // első beállítást nem lehet átugrani

  const prefs = loadPreferences();
  if (!prefs) return renderClassStep(true);
  const cls = getAvailableClasses().find(c => c.id === prefs.classId);
  if (!cls) { clearPreferences(); return renderClassStep(true, 'A korábban választott osztály már nem érhető el.'); }
  try {
    const data = await loadClassData(cls);
    const known = getAvailableGroups(data);
    if (prefs.groups.every(g => known.includes(g))) {
      Object.assign(state, { cls, data, groups: prefs.groups });
      return render();
    }
    renderClassStep(true, 'A mentett csoportjaid megváltoztak, válaszd ki őket újra.');
  } catch (e) { renderClassStep(true, e.message); }
}
init();
