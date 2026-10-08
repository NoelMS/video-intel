// Mock backend. Every export mirrors an endpoint in the spec (POST /search, GET /memory, ...).
// Swap the bodies for fetch()/SSE calls; the UI only depends on the returned shapes.
import * as DEMO_DATA from './data.js';

// The active dataset: the synthetic demo (data.js) or "My footage" built by indexer.mjs, same shape either way.
let D = DEMO_DATA, realVocab = null, watchVocab = null;
export const W = [0, 0];                       // mutated in place by useDataset, so importers keep the same array
let cams = new Map(), evs = new Map();
export const ds = () => D;
export function useDataset(d) {
  D = d; realVocab = watchVocab = null;
  d.WINDOW.forEach((t, i) => { W[i] = sec(t); });
  cams = new Map(d.cameras.map(c => [c.id, c]));
  evs = new Map(d.events.map(e => [e.id, e]));
}

const mem = new Map();
let store = (() => {
  try { if (typeof localStorage !== 'undefined') { localStorage.getItem('vi'); return localStorage; } } catch {}
  return { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
})();
// Server plugs in file-backed storage; the browser uses localStorage (or memory when blocked).
export const useStorage = s => { store = s; };
const load = (k, d) => { try { return JSON.parse(store.getItem(k)) ?? d; } catch { return d; } };
const save = (k, v) => { try { store.setItem(k, JSON.stringify(v)); } catch {} };
export const kv = { load, save };            // the server shares this storage with indexer.mjs
const today = () => new Date().toISOString().slice(0, 10);

export const sec = t => { const [h, m, s = 0] = t.split(':').map(Number); return h * 3600 + m * 60 + s; };
export const hms = s => [s / 3600, (s % 3600) / 60, s % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':');
export const dur = s => (s = Math.round(s)) >= 3600 ? `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m` : s >= 60 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
useDataset(DEMO_DATA);
export const camera = id => cams.get(id);
export const event = id => evs.get(id);
export const object = track => ({ id: track, name: D.tracks[track], ...journey(track) });

// GET /cameras, GET /cameras/:id/events
export const getCameras = async () => D.cameras;
export const getDataset = async () => D;
export const getEvents = async (cameraId) => D.events.filter(e => !cameraId || e.cameraId === cameraId);

// GET/POST/PUT/DELETE /memory
export async function getMemory() {
  let m = load('vi.memory', null);
  if (!m) save('vi.memory', m = DEMO_DATA.seedReferents);
  return m;
}
export async function createMemory(r) {
  const ref = { id: 'ref_' + Date.now().toString(36), definedBy: 'Operator', created: today(), uses: 0, lastUsed: null, ...r };
  save('vi.memory', [...await getMemory(), ref]);
  return ref;
}
export async function updateMemory(id, patch) {
  save('vi.memory', (await getMemory()).map(r => r.id === id ? { ...r, ...patch } : r));
}
export async function deleteMemory(id) {
  save('vi.memory', (await getMemory()).filter(r => r.id !== id));
}

// Investigation notebook: history, saved evidence, notes.
// Retention and expiry are enforced on read, so a stale record is never served as current.
const ageDays = iso => (Date.now() - new Date(iso)) / 864e5;
export const getHistory = async () => { const { privacy } = await getSettings(); return load('vi.history', []).filter(h => ageDays(h.at) <= privacy.retentionDays); };
// Saved items form the evidence board: { id, kind: 'event' | 'journey', eventId | track, lane, query, savedAt }. Array order = board order.
export const LANES = { primary: 'Primary evidence', supporting: 'Supporting', context: 'Context', unsorted: 'Unsorted' };
const norm = x => ({ kind: 'event', lane: 'unsorted', id: x.eventId, ...x }); // items saved before the board existed
const savedRaw = () => load('vi.saved', []).map(norm);
export const getSaved = async () => { const { privacy } = await getSettings(); return savedRaw().map(x => ({ ...x, expired: ageDays(x.savedAt) > privacy.expiryDays })); };
export const getAudit = async () => load('vi.audit', []);
export async function addAudit(entry) {
  if (entry.action === 'reveal' && (await getSettings()).operator.role !== 'supervisor')
    throw Object.assign(new Error('Revealing protected regions requires the supervisor role'), { status: 403 });
  const row = { at: new Date().toISOString(), ...entry };
  save('vi.audit', [row, ...load('vi.audit', [])].slice(0, 200));
  return row;
}
export const getNotes = async () => load('vi.notes', '');
export const setNotes = async t => save('vi.notes', t);
function addItem(item) {
  const s = savedRaw();
  if (!s.some(x => x.id === item.id)) save('vi.saved', [...s, { lane: 'unsorted', savedAt: new Date().toISOString(), ...item }]);
}
export const saveEvidence = async (eventId, query) => addItem({ id: eventId, kind: 'event', eventId, query });
export const saveJourney = async (track, query) => addItem({ id: 'journey:' + track, kind: 'journey', track, query });
export const removeEvidence = async id => save('vi.saved', savedRaw().filter(x => x.id !== id));
export async function moveItem(id, lane, index) {
  const all = savedRaw(), it = all.find(x => x.id === id);
  if (!it || !LANES[lane]) return;
  const rest = all.filter(x => x !== it), inLane = rest.filter(x => x.lane === lane);
  const at = index < inLane.length ? rest.indexOf(inLane[Math.max(0, index)]) : inLane.length ? rest.indexOf(inLane.at(-1)) + 1 : rest.length;
  rest.splice(at, 0, { ...it, lane });
  save('vi.saved', rest);
}

// GET/PUT /settings. Model identifiers are recorded for provenance; the demo pipeline runs no models.
export const DEPTHS = {
  fast: { label: 'Fast', topK: 3, cross: false, speed: 0.5, note: 'Top 3 candidates, no cross-camera validation. Quickest answer.' },
  balanced: { label: 'Balanced', topK: 8, cross: true, speed: 1, note: 'Top 8 candidates with cross-camera validation.' },
  deep: { label: 'Deep', topK: 999, cross: true, speed: 1.6, note: 'Every candidate expanded and validated. Slowest.' },
};
export const DEFAULT_SETTINGS = {
  depth: 'balanced',
  source: 'demo', day: null,                              // day: which day of your footage to search (null = latest)                                         // 'demo' (synthetic) or 'mine' (indexed recordings)
  pipeline: { sampling: 0.5, refinement: 4 },             // frames per second sampled from recordings
  privacy: { faces: true, plates: true, onPrem: true, retentionDays: 30, expiryDays: 90, exports: 'watermarked' },
  operator: { role: 'analyst' },
  vision: { model: 'qwen3-vl:2b-instruct', setupSeen: false },   // local analysis via Ollama (setup.mjs)
};
export const ROLES = ['viewer', 'analyst', 'supervisor'];
export const EXPORTS = { allowed: 'Allowed', watermarked: 'Watermarked', disabled: 'Disabled' };
export async function getSettings() {
  const s = load('vi.settings', {});
  return Object.fromEntries(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, ...s[k] } : s[k] ?? v]));
}
export async function setSettings(patch) {
  const cur = await getSettings();
  const next = Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v, ...patch[k] } : k in patch ? patch[k] : v]));
  save('vi.settings', next);
  return next;
}

// ---------- geometry ----------
export const pointAt = (e, t) => [0, 1].map(i => e.path[0][i] + (e.path[1][i] - e.path[0][i]) * t);
export function pathHits(e, [x, y, w, h]) {
  for (let i = 0; i <= 20; i++) {
    const [px, py] = pointAt(e, i / 20);
    if (px >= x && px <= x + w && py >= y && py <= y + h) return true;
  }
  return false;
}

// Gaps in recorded coverage inside a window. Offline cameras are reported, never silently searched.
export function coverageGaps(list, [a, b]) {
  const out = [];
  for (const c of list) {
    if (c.status === 'offline') { out.push({ cameraId: c.id, kind: 'offline', available: c.coverage }); continue; }
    let cur = a;
    for (const [s, e] of c.coverage.map(r => r.map(sec))) {
      if (s > cur && cur < b) out.push({ cameraId: c.id, kind: 'gap', from: cur, to: Math.min(s, b) });
      cur = Math.max(cur, e);
    }
    if (cur < b) out.push({ cameraId: c.id, kind: 'gap', from: cur, to: b });
  }
  return out;
}

// ---------- query understanding ----------
const ENTITY = {
  vehicle: /\b(cars?|vehicles?|sedans?|vans?|suvs?|trucks?|hatchbacks?|automobiles?)\b/,
  person: /\b(person|people|anyone|anybody|someone|somebody|who|man|woman|everyone|nobody)\b/,
};
const ATTRS = ['red', 'white', 'black', 'blue', 'grey', 'maroon', 'dark', 'sedan', 'van', 'suv', 'hatchback', 'bag', 'box', 'jacket', 'coat', 'large'];
const CLOCK = '(\\d{1,2})(?:[:.](\\d{2}))?\\s*(am|pm)?';
const toSec = (h, m, ap) => { h = +h; if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; return h * 3600 + +(m || 0) * 60; };
const clock = (lc, word) => { const m = lc.match(new RegExp(`\\b${word} ${CLOCK}\\b`)); return m ? toSec(m[1], m[2], m[3]) : null; };
const PARTS = { morning: [6, 12], afternoon: [12, 17], evening: [17, 21], night: [20, 24] };
// When: "after 9:40", "before 10pm", "since 9", "until 11", "between 9 and 9:30", "at 9:14" (+-5 min), "this morning",
// and "in the last hour / past 20 minutes", which `recent` measures back from the end of the footage (search resolves it).
export function timeWindow(lc) {
  let m = lc.match(new RegExp(`\\bbetween ${CLOCK} and ${CLOCK}\\b`));
  if (m) return { after: toSec(m[1], m[2], m[3] || m[6]), before: toSec(m[4], m[5], m[6]) };
  m = lc.match(/\b(?:in )?the (?:last|past) (?:(\d+|half(?: an?)?|an?) )?(hours?|minutes?|mins?)\b/);
  if (m) { const n = !m[1] || /^an?$/.test(m[1]) ? 1 : /^half/.test(m[1]) ? 0.5 : +m[1]; return { recent: n * (/^h/.test(m[2]) ? 3600 : 60) }; }
  m = lc.match(new RegExp(`\\bat ${CLOCK}\\b`));
  if (m && (m[2] || m[3])) { const at = toSec(m[1], m[2], m[3]); return { after: Math.max(0, at - 300), before: at + 300 }; }   // "at 9:14", not "at 3 cameras"
  if (/\btonight\b/.test(lc)) return { after: PARTS.night[0] * 3600, before: PARTS.night[1] * 3600 };
  const part = Object.keys(PARTS).find(k => new RegExp(`\\b(this|in the|at|last) ${k}\\b`).test(lc));
  if (part) return { after: PARTS[part][0] * 3600, before: PARTS[part][1] * 3600 };
  return { after: clock(lc, 'after') ?? clock(lc, 'since'), before: clock(lc, 'before') ?? clock(lc, 'until') };
}

// vocab: words that count as attributes: the demo's ATTRS, or on real footage the words that occur in its labels. (The
// demo's list leaked into real footage twice: "jacket" became a required word no real label has, and a watch for "a bus"
// knew no "bus", so it matched every object.) Other words are left to the image similarity.
const vocabOf = () => D.DEMO ? ATTRS : (realVocab ??= [...new Set(D.events.flatMap(e => e.attrs))]);
// Every word a real label can hold: the indexer's naming choices (indexer.mjs) and the detector's kept classes
// (detector.mjs). A watch has no pictures to fall back on, so it must know "bus" before the first bus is indexed.
const LABEL_WORDS = ['black', 'white', 'grey', 'silver', 'red', 'blue', 'green', 'yellow', 'orange', 'brown', 'beige', 'purple', 'pink',
  'hatchback', 'saloon', 'estate', 'suv', 'taxi', 'van', 'pickup', 'lorry', 'bus', 'bicycle', 'motorcycle',
  'bag', 'backpack', 'handbag', 'suitcase', 'umbrella', 'phone', 'child',
  'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe'];
const watchVocabOf = () => D.DEMO ? ATTRS : (watchVocab ??= [...new Set([...LABEL_WORDS, ...vocabOf()])]);
// "what happened", "anything after 9": a question about activity, not about a thing. "Find an elephant" is about a thing
// the labels never name; it stays a find, so the image similarity ranks it and the visual check can reject it.
const GENERIC = /\b(what|anything|activity|happen(ed|ing|s)?|going on|events?)\b/;
export function interpret(text, refs, context, vocab = vocabOf()) {
  const lc = ' ' + text.toLowerCase().replace(/gray/g, 'grey') + ' ';
  const entity = Object.keys(ENTITY).find(k => ENTITY[k].test(lc)) || null;
  const attrs = vocab.filter(a => new RegExp(`\\b${a}\\b`).test(lc) && !Object.values(ENTITY).some(re => re.test(` ${a} `)));
  const ref = refs.find(r => [r.name, ...(r.aliases || [])].some(n => lc.includes(n.toLowerCase())));
  let location = ref ? { term: ref.name, ref } : null;
  if (!location) {
    const m = lc.match(/\b(?:the|near|at|through|into|by)\s+((?:[a-z]+\s)?(?:gate|entrance|exit|area|door|dock|bay|zone|corridor|yard))\b/);
    if (m) location = { term: m[1].replace(/^(the|near|at|by)\s/, ''), ref: null };
  }
  const follow = context && /\b(it|this|that|they|them|he|she|the same)\b/.test(lc) ? context : null;
  const journey = /\bwhere (did|does|do|was|is|has)\b|\bfollow\b|\bjourney\b/.test(lc);
  return {
    text, entity, attrs, location, follow,
    crossing: /\b(pass(ed|es)?|through|enter(ed|s|ing)?|came in|went in)\b/.test(lc),
    intent: journey ? 'journey' : !entity && !attrs.length && !follow && GENERIC.test(lc) ? 'activity' : 'find',
    ...timeWindow(lc),
    yesNo: /^\s*(did|was|were|is|are|has|have)\b/.test(lc),
  };
}

// ---------- evidence assessment ----------
export const score = e => (e.conf.semantic + e.conf.visual) / 2;
export const level = v => v >= 0.85 ? 'HIGH' : v >= 0.65 ? 'MEDIUM' : 'LOW';
const inWin = (e, [a, b]) => sec(e.time) >= a && sec(e.time) <= b;

export function checks(e, q, win) {
  const out = [];
  if (q.entity) out.push([e.entity === q.entity, `Entity · ${e.entity}`]);
  q.attrs.forEach(a => out.push([e.attrs.includes(a), `Attribute · ${a}`]));
  out.push([inWin(e, win), inWin(e, win) ? 'Inside requested window' : 'Outside requested window']);
  const ref = q.location?.ref;
  if (ref) {
    const here = e.cameraId === ref.cameraId;
    out.push([here, `${here ? 'Observed' : 'Not observed'} on ${camera(ref.cameraId).code}`]);
    if (here && q.crossing) {
      const hit = pathHits(e, ref.region);
      out.push([hit, `${hit ? 'Crossed' : 'Did not cross'} ${ref.name} region`]);
    }
  }
  return out.map(([ok, text]) => ({ ok, text }));
}

export function journey(track) {
  const s = D.events.filter(e => e.track === track).sort((a, b) => sec(a.time) - sec(b.time));
  const transitions = s.slice(1).map((b, i) => {
    const a = s[i], gap = sec(b.time) - sec(a.time);
    const adjacent = camera(a.cameraId).neighbors.includes(b.cameraId);
    const vis = Math.min(a.conf.visual, b.conf.visual);
    // Real footage is linked by described appearance only (indexer.mjs), which never justifies more than "possible".
    const byText = b.match;
    return {
      from: a.id, to: b.id, gap,
      strength: byText ? 'possible' : adjacent && vis >= 0.75 ? 'strong' : adjacent || vis >= 0.75 ? 'likely' : 'possible',
      reasons: [
        byText ? { ok: true, text: `Described alike: ${byText.shared.join(', ')}` }
          : { ok: vis >= 0.75, text: vis >= 0.75 ? 'Similar appearance' : 'Partially similar appearance' },
        { ok: adjacent, text: adjacent ? 'Adjacent in known camera topology' : 'Cameras not directly connected' },
        { ok: gap < 600, text: `${gap < 600 ? 'Compatible' : 'Long'} time gap · ${dur(gap)}` },
      ],
      // only cameras that sit next to either end of the hop could have seen the entity in between
      gaps: coverageGaps(D.cameras.filter(c => ![a.cameraId, b.cameraId].includes(c.id) && [a.cameraId, b.cameraId].some(x => c.neighbors.includes(x) || camera(x).neighbors.includes(c.id))), [sec(a.time), sec(b.time)]),
    };
  });
  return { track, entity: s[0].entity, sightings: s.map(e => e.id), transitions };
}

export function assess(e, q, { cross = true } = {}) {
  const tr = journey(e.track).transitions.filter(t => t.from === e.id || t.to === e.id);
  const ref = q?.location?.ref;
  return [
    ['Semantic match', level(e.conf.semantic)],
    ['Visual match', level(e.conf.visual)],
    ['Temporal fit', q && !inWin(e, [q.after ?? W[0], q.before ?? W[1]]) ? 'LOW' : 'HIGH'],
    ['Location fit', !ref ? 'N/A' : e.cameraId !== ref.cameraId ? 'LOW' : pathHits(e, ref.region) ? 'HIGH' : 'MEDIUM'],
    ['Cross-camera link', !cross ? 'NOT CHECKED' : !tr.length ? 'NONE' : tr.some(t => t.strength === 'strong') ? 'HIGH' : 'MEDIUM'],
  ];
}

// ---------- standing queries (§33), alerts (§34), live replay (§32) ----------
const SEED_WATCHES = [
  { id: 'w_rear', text: 'Anyone entering the rear entrance', scope: 'all', from: '09:30', to: '10:00', status: 'active', created: '2026-10-05' },
  { id: 'w_van', text: 'White van at the loading area', scope: 'all', from: '09:00', to: '10:00', status: 'active', created: '2026-10-06' },
  { id: 'w_night', text: 'Anyone entering the rear entrance', scope: 'cam_09', from: '20:00', to: '06:00', status: 'active', created: '2026-10-06' },
];
export async function getWatches() { let w = load('vi.watches', null); if (!w) save('vi.watches', w = SEED_WATCHES); return w; }
export async function createWatch(w) {
  const row = { id: 'w_' + Date.now().toString(36), status: 'active', created: today(), ...w };
  save('vi.watches', [...await getWatches(), row]);
  return row;
}
export const updateWatch = async (id, patch) => save('vi.watches', (await getWatches()).map(w => w.id === id ? { ...w, ...patch } : w));
export const deleteWatch = async id => save('vi.watches', (await getWatches()).filter(w => w.id !== id));
export const getAlerts = async () => load('vi.alerts', []);
export async function addAlert(w, e) {
  const all = load('vi.alerts', []), id = `${w.id}:${e.id}`;
  if (all.some(a => a.id === id)) return null; // one alert per watch and event, even across replays
  const row = { id, watchId: w.id, watchText: w.text, eventId: e.id, at: new Date().toISOString() };
  save('vi.alerts', [row, ...all].slice(0, 200));
  return row;
}

export const inSchedule = (t, w) => { const [a, b] = [sec(w.from), sec(w.to)]; return a <= b ? t >= a && t <= b : t >= a || t <= b; };
// null = watch cannot be evaluated (names a place nobody has defined yet).
export function matchWatch(w, e, refs) {
  const q = interpret(w.text, refs, null, watchVocabOf());
  if (q.location && !q.location.ref) return null;
  // a thing no label names ("an elephant") cannot be matched without the pictures; never fire on every object instead
  if (q.intent === 'find' && !q.entity && !q.attrs.length && !q.location) return false;
  if (!inSchedule(sec(e.time), w) || (w.scope !== 'all' && w.scope !== e.cameraId)) return false;
  return checks(e, q, [q.after ?? 0, q.before ?? 86400]).every(c => c.ok);
}

// Camera stream state at replay time t: no signal when the recording has nothing at t.
export const streamState = (c, t) => c.coverage.some(([a, b]) => t >= sec(a) && t < sec(b)) ? 'STREAMING' : 'NO SIGNAL';

// Replays the recorded window as if it were arriving live. Same detection -> watch path a real stream would take.
export async function live({ speed = 60, from = W[0], tickMs = 250, onTick = () => {}, onEvent = () => {}, onAlert = () => {}, signal } = {}) {
  const refs = await getMemory(), watches = (await getWatches()).filter(w => w.status === 'active');
  const queue = [...D.events].sort((a, b) => sec(a.time) - sec(b.time)).filter(e => sec(e.time) > from); // > so a resume never replays the event it paused on
  let t = from;
  while (t < W[1]) {
    await wait(tickMs, signal);
    t = Math.min(W[1], t + speed * Math.max(tickMs, 250) / 1000);
    while (queue.length && sec(queue[0].time) <= t) {
      const e = queue.shift(), t0 = performance.now();
      const hits = watches.filter(w => matchWatch(w, e, refs));
      onEvent({ id: e.id, watches: hits.map(w => w.id), evalMs: +(performance.now() - t0).toFixed(2) });
      for (const w of hits) { const a = await addAlert(w, e); if (a) onAlert(a); }
    }
    onTick({ t, streams: Object.fromEntries(D.cameras.map(c => [c.id, streamState(c, t)])) });
  }
}

// ---------- POST /search (stages stream through onStage, as SSE would) ----------
const DELAY = { interpreted: 250, retrieval: 450, semantic: 350, temporal: 300, grounding: 450, cross_camera: 350, verification: 300 };
const wait = (ms, signal) => new Promise((res, rej) => {
  const abort = () => { clearTimeout(t); rej(new DOMException('Search cancelled', 'AbortError')); };
  if (signal?.aborted) return abort();
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', abort, { once: true });
});

// verify(event, question) -> { answer: 'yes' | 'no' | 'unsure', reason, model }: the server passes the local vision
// model for real footage. The demo has nothing to look at, so it never verifies visually.
// Open vocabulary: with image embeddings (real footage), three signals are blended, each on a 0-1 scale:
// - object: how well the object's crop matches the query, as a percentile among the objects being searched;
// - frame: how well the best whole frame while the object is on screen matches (also a percentile), which carries
//   context the crop lacks (the car the person is getting out of, the bicycle under the cyclist);
// - labels: the share of the query's attribute words in the object's label.
// Words outside the label vocabulary still count through the pictures; known colours and kinds still sharpen the
// ranking. Without embeddings (the demo), ranking is the label score as before. Weights tuned on the dev split only.
export const OPEN_VOCAB = { object: 0.5, frame: 0, labels: 0.5, pass: 0.75 };   // frame 0: it picks each object's moment, but ranking by it hurt on dev (Hit@5 0.64 -> 0.41 at 0.2)
const percentile = values => {
  const v = values.filter(x => x != null).sort((a, b) => a - b);
  return x => { let lo = 0, hi = v.length; while (lo < hi) { const m = (lo + hi) >> 1; v[m] < x ? lo = m + 1 : hi = m; } return v.length > 1 ? lo / (v.length - 1) : 1; };
};
export function openVocab(pool, q, sim, frames = null, weights = {}) {
  const W8 = { ...OPEN_VOCAB, ...weights };
  const attrsOk = e => q.attrs.every(a => e.attrs.includes(a));
  if (!sim?.size && !frames?.size) return Object.assign(e => score(e), { pass: attrsOk });
  const po = sim?.size ? percentile(pool.map(e => sim.get(e.id))) : null, pf = frames?.size ? percentile(pool.map(e => frames.get(e.id)?.score)) : null;
  const share = e => q.attrs.length ? q.attrs.filter(a => e.attrs.includes(a)).length / q.attrs.length : null;
  const rank = e => {
    let s = 0, w = 0;
    if (po) { s += W8.object * (sim.has(e.id) ? po(sim.get(e.id)) : 0); w += W8.object; }
    if (pf) { s += W8.frame * (frames.has(e.id) ? pf(frames.get(e.id).score) : 0); w += W8.frame; }
    const a = share(e);
    if (a != null) { s += W8.labels * a; w += W8.labels; }
    return w ? s / w : 0;
  };
  return Object.assign(rank, { pass: e => (q.attrs.length > 0 && attrsOk(e)) || rank(e) >= W8.pass });
}

export async function search(text, { scope = 'all', context = null, depth, onStage = () => {}, signal, speed = 1, verify = null, sim = null, frames = null, labels = true, weights = {} } = {}) {
  const t0 = Date.now();
  const refs = (await getMemory()).filter(r => camera(r.cameraId)), settings = await getSettings();
  const dk = DEPTHS[depth] ? depth : settings.depth, dp = DEPTHS[dk];
  const funnel = [];
  const step = async (stage, label, count, extra, delay = DELAY[stage]) => {
    await wait(delay * speed * dp.speed, signal); // ponytail: simulated latency for the demo pipeline; real stages arrive via SSE
    const s = { stage, label, count, ms: Date.now() - t0, ...extra };
    funnel.push(s); onStage(s);
  };

  // Attribute words are the ones the labels can contain: on real footage, words that occur in its labels. (The demo's
  // vocabulary leaked in before: "jacket" became a required attribute no real label has, so "the person in a red
  // jacket" matched nobody.) Other words are left to the image similarity.
  const q = interpret(text, refs, context);
  await step('interpreted', 'Query interpreted', null, { interp: q });
  if (q.location && !q.location.ref) return { status: 'clarify', interp: q, funnel };

  if (q.recent) Object.assign(q, { after: Math.max(W[0], W[1] - q.recent), before: W[1] });   // "in the last hour" of the footage
  const win = [q.after ?? W[0], q.before ?? W[1]];
  const scoped = D.cameras.filter(c => (scope === 'all' || c.id === scope) && (!q.location || c.id === q.location.ref.cameraId));
  const searched = scoped.filter(c => c.status !== 'offline');
  const coverage = coverageGaps(scoped, win);
  const coveredSec = searched.reduce((n, c) => n + c.coverage.map(r => r.map(sec))
    .reduce((m, [s, e]) => m + Math.max(0, Math.min(e, win[1]) - Math.max(s, win[0])), 0), 0);
  await step('retrieval', `Indexed segments across ${searched.length} camera${searched.length === 1 ? '' : 's'}`, Math.floor(coveredSec / 10));

  const pool = D.events.filter(e => searched.some(c => c.id === e.cameraId));
  const rank = openVocab(pool, labels ? q : { ...q, attrs: [] }, sim, frames, weights);
  const semantic = pool.filter(e => (!q.entity || e.entity === q.entity) && (!q.follow || e.track === q.follow.track) && rank.pass(e))
    .sort((a, b) => rank(b) - rank(a)).slice(0, dp.topK);
  await step('semantic', `Semantic matches · top ${dp.topK === 999 ? 'all' : dp.topK}`, semantic.length);
  const timed = semantic.filter(e => inWin(e, win));
  await step('temporal', 'Inside requested window', timed.length);
  const grounded = q.location ? timed.filter(e => e.cameraId === q.location.ref.cameraId) : timed;
  await step('grounding', q.location ? `Grounded at ${q.location.ref.name}` : 'Grounded objects', grounded.length);
  const tracks = new Set(grounded.map(e => e.track));
  if (dp.cross) await step('cross_camera', 'Tracks seen on more than one camera', [...tracks].filter(t => new Set(D.events.filter(e => e.track === t).map(e => e.cameraId)).size > 1).length);
  else await step('cross_camera', 'Skipped in fast mode', null, null, 0);

  const needCross = q.location && q.crossing && q.intent === 'find';
  let verified = grounded.filter(e => !needCross || pathHits(e, q.location.ref.region));
  const keep = new Set(verified.map(e => e.track));
  const rejected = semantic.filter(e => !keep.has(e.track) && !verified.includes(e))
    .filter((e, i, a) => a.findIndex(x => x.track === e.track) === i).slice(0, dk === 'deep' ? 6 : 3)
    .map(e => ({ id: e.id, checks: checks(e, q, win) }));
  // Visual verification: the model looks at each top candidate's frame again with the question. "no" rejects it.
  const visual = {};
  if (verify && q.intent === 'find' && dk !== 'fast') {
    for (const e of [...verified].sort((a, b) => rank(b) - rank(a)).slice(0, dk === 'deep' ? 6 : 3)) {
      if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError');
      const r = await verify(e, text);
      visual[e.id] = { ok: r.answer === 'yes', text: `Visual check (${r.model}): ${r.answer === 'yes' ? 'confirmed' : r.answer}, ${r.reason}` };
      if (r.answer === 'no') { verified = verified.filter(x => x !== e); rejected.push({ id: e.id, checks: [...checks(e, q, win), visual[e.id]] }); }
    }
    // Nothing in the words to check ("Find an elephant"): the image ranking always has a top few, so only what the model
    // confirmed counts. Otherwise, after it rejects its top picks, the unchecked ones below were offered as matches.
    if (!q.entity && !q.attrs.length && !q.follow) verified = verified.filter(e => visual[e.id]?.ok);
  }
  await step('verification', Object.keys(visual).length ? `Visually checked ${Object.keys(visual).length} by the local model` : 'Verified against evidence', verified.length);

  const byTrack = new Map();
  for (const e of [...verified].sort((a, b) => rank(b) - rank(a))) if (!byTrack.has(e.track)) byTrack.set(e.track, e);
  const best = [...byTrack.values()];
  const diag = { depth: dk, cross: dp.cross, topK: dp.topK, pipeline: { ...settings.pipeline, onPrem: settings.privacy.onPrem }, retrieved: semantic.map(e => ({ id: e.id, score: +rank(e).toFixed(3), ...(sim?.has(e.id) ? { image: +sim.get(e.id).toFixed(3) } : {}) })), openVocab: !!sim?.size };
  // the moment each candidate best matches the query (clip time), when frame embeddings say so
  const moments = frames?.size ? Object.fromEntries(semantic.filter(e => frames.has(e.id)).map(e => [e.id, frames.get(e.id).vt])) : undefined;
  const base = { moments, interp: q, window: win, scoped: scoped.map(c => c.id), coverage, rejected, funnel, diag, visual, ms: Date.now() - t0 };

  let res;
  if (q.intent === 'journey' && (q.follow || best.length)) {
    const track = q.follow?.track ?? best.sort((a, b) => journey(b.track).sightings.length - journey(a.track).sightings.length)[0].track;
    res = { ...base, status: 'journey', journey: journey(track), alternatives: best.filter(e => e.track !== track).map(e => e.id) };
  } else if (q.intent === 'activity') {
    res = { ...base, status: verified.length ? 'activity' : 'empty', events: verified.sort((a, b) => sec(a.time) - sec(b.time)).map(e => e.id) };
  } else if (!best.length) {
    res = { ...base, status: rejected.length ? 'refusal' : 'empty' };
  } else if (best.length === 1 || rank(best[0]) - rank(best[1]) > 0.15) {
    res = { ...base, status: 'supported', primary: best[0].id, alternatives: best.slice(1).map(e => e.id), checks: [...checks(best[0], q, win), ...(visual[best[0].id] ? [visual[best[0].id]] : [])] };
  } else {
    // the top three side by side; the other matches listed under them, not dropped
    res = { ...base, status: 'ambiguous', candidates: best.slice(0, 3).map(e => e.id), more: best.slice(3).map(e => e.id) };
  }

  save('vi.history', [{ text, at: new Date().toISOString(), status: res.status, n: verified.length }, ...load('vi.history', [])].slice(0, 50));
  if (q.location?.ref) await updateMemory(q.location.ref.id, { uses: (q.location.ref.uses || 0) + 1, lastUsed: today() });
  return res;
}
