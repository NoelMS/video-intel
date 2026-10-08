// Optional backend: static files + the §90 REST endpoints + SSE search stages, persisted to a JSON file.
// No dependencies. `node server.mjs` (PORT, VI_STORE env vars optional).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { join, normalize, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as api from './api.js';
import * as setup from './setup.mjs';
import * as indexer from './indexer.mjs';
import * as sources from './sources.mjs';
import * as baseline from './baseline.mjs';
import * as DEMO from './data.js';

const root = dirname(fileURLToPath(import.meta.url));
const BOOT = Date.now(), CODE = ['server.mjs', 'api.js', 'indexer.mjs', 'setup.mjs', 'data.js'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.webm': 'video/webm' };

function fileStore(file) {
  let db = {};
  try { if (existsSync(file)) db = JSON.parse(readFileSync(file, 'utf8')); } catch { console.warn(`store unreadable, starting empty: ${file}`); }
  return {
    getItem: k => db[k] ?? null,
    setItem: (k, v) => { db[k] = v; mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, JSON.stringify(db, null, 1)); },
  };
}

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = msg => { throw new HttpError(400, msg); };

async function body(req) {
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 2e6) throw new HttpError(413, 'Body too large'); }
  try { return raw ? JSON.parse(raw) : {}; } catch { bad('Body is not valid JSON'); }
}

// Trust boundary: everything a client can persist is validated here.
function validRef(r, partial = false) {
  const out = {};
  if (!partial || 'name' in r) { if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 80) bad('name must be 1-80 characters'); out.name = r.name.trim(); }
  if (!partial || 'cameraId' in r) { if (!api.camera(r.cameraId)) bad('unknown cameraId'); out.cameraId = r.cameraId; }
  if (!partial || 'region' in r) {
    const g = r.region;
    if (!Array.isArray(g) || g.length !== 4 || g.some(n => !Number.isFinite(n) || n < 0) || g[0] + g[2] > 640 || g[1] + g[3] > 360 || g[2] < 4 || g[3] < 4) bad('region must be [x, y, w, h] inside 640x360');
    out.region = g.map(Math.round);
  }
  if (r.aliases != null) { if (!Array.isArray(r.aliases) || r.aliases.some(a => typeof a !== 'string' || a.length > 80)) bad('aliases must be strings'); out.aliases = r.aliases; }
  return out;
}

const validModel = m => typeof m === 'string' && /^[\w.\-]+(\/[\w.\-]+)*(:[\w.\-]+)?$/.test(m) && m.length <= 80 ? m : bad('model must be an Ollama model name like qwen3-vl:2b');

function validSettings(b) {
  const out = {};
  if (b.depth != null) { if (!api.DEPTHS[b.depth]) bad('depth must be fast, balanced or deep'); out.depth = b.depth; }
  if (b.pipeline != null) {
    out.pipeline = {};
    for (const k of ['embedding', 'detector', 'tracker', 'reid']) if (k in b.pipeline) { const v = b.pipeline[k]; if (typeof v !== 'string' || !v.trim() || v.length > 80) bad(`${k} must be 1-80 characters`); out.pipeline[k] = v.trim(); }
    if ('sampling' in b.pipeline) { const v = +b.pipeline.sampling; if (!(v >= 0.1 && v <= 30)) bad('sampling must be 0.1-30 fps'); out.pipeline.sampling = v; }
    if ('refinement' in b.pipeline) { const v = +b.pipeline.refinement; if (!Number.isInteger(v) || v < 0 || v > 30) bad('refinement must be 0-30 s'); out.pipeline.refinement = v; }
  }
  if (b.privacy != null) {
    const p = b.privacy, o = out.privacy = {};
    for (const k of ['faces', 'plates', 'onPrem']) if (k in p) { if (typeof p[k] !== 'boolean') bad(`${k} must be boolean`); o[k] = p[k]; }
    for (const k of ['retentionDays', 'expiryDays']) if (k in p) { if (!Number.isInteger(p[k]) || p[k] < 1 || p[k] > 3650) bad(`${k} must be 1-3650 days`); o[k] = p[k]; }
    if ('exports' in p) { if (!api.EXPORTS[p.exports]) bad('exports must be allowed, watermarked or disabled'); o.exports = p.exports; }
  }
  if (b.operator != null) { if (!api.ROLES.includes(b.operator.role)) bad('role must be viewer, analyst or supervisor'); out.operator = { role: b.operator.role }; }
  if (b.source != null) { if (!['demo', 'mine'].includes(b.source)) bad('source must be demo or mine'); out.source = b.source; }
  if ('day' in b) { if (b.day !== null && !/^\d{4}-\d\d-\d\d$/.test(b.day)) bad('day must be YYYY-MM-DD'); out.day = b.day; }
  if (b.vision != null) {
    out.vision = {};
    if ('model' in b.vision) out.vision.model = validModel(b.vision.model);
    if ('setupSeen' in b.vision) { if (typeof b.vision.setupSeen !== 'boolean') bad('setupSeen must be boolean'); out.vision.setupSeen = b.vision.setupSeen; }
  }
  return out;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
function validWatch(b, partial = false) {
  const out = {};
  if (!partial || 'text' in b) { if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 300) bad('text must be 1-300 characters'); out.text = b.text.trim(); }
  if (!partial || 'scope' in b) { if (b.scope !== 'all' && !api.camera(b.scope)) bad('unknown scope'); out.scope = b.scope; }
  for (const k of ['from', 'to']) if (!partial || k in b) { if (!HHMM.test(b[k])) bad(`${k} must be HH:MM`); out[k] = b[k]; }
  if ('status' in b) { if (!['active', 'paused'].includes(b.status)) bad('status must be active or paused'); out.status = b.status; }
  return out;
}

const str = (v, max, field) => { if (typeof v !== 'string' || !v.trim() || v.length > max) bad(`${field} must be 1-${max} characters`); return v.trim(); };
const iso = (v, field) => { if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) bad(`${field} must be an ISO date`); return new Date(v).toISOString(); };
// Upload metadata travels in the query string; the body is the raw video stream.
const VIDEO_EXT = ['.mp4', '.m4v', '.mov', '.mkv', '.avi', '.webm', '.ts', '.mts', '.m2ts', '.wmv', '.asf', '.flv', '.3gp', '.h264', '.h265', '.hevc', '.dav'];
function validUpload(qs, type) {
  const g = k => qs.get(k) ?? '';
  if (!/^(video\/[\w.+-]+|application\/octet-stream)$/.test(type)) bad('Send the video as video/* or application/octet-stream');
  const out = { name: str(g('name'), 80, 'name'), location: str(g('location') || 'Unspecified', 120, 'location'), tz: str(g('tz'), 64, 'tz'), start: iso(g('start'), 'start') };
  try { new Intl.DateTimeFormat('en', { timeZone: out.tz }); } catch { bad('unknown timezone'); }
  out.neighbors = g('neighbors') ? g('neighbors').split(',').map(n => indexer.listVideos().some(v => v.id === n) ? n : bad(`unknown neighbouring camera ${n}`)) : [];
  out.labels = g('labels') ? g('labels').split(',').slice(0, 10).map(l => str(l, 60, 'label')) : [];
  out.ext = (g('filename').match(/\.[a-z0-9]{1,5}$/i)?.[0] || '').toLowerCase();
  if (!VIDEO_EXT.includes(out.ext)) bad(`Unsupported file type ${out.ext || '(none)'}`);
  return out;
}

// Serves a file with HTTP Range support so the original video can be scrubbed.
function sendFile(req, res, file, type) {
  if (!existsSync(file)) throw new HttpError(404, 'Not found');
  const size = statSync(file).size, m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  const head = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' };
  if (!m) { res.writeHead(200, { ...head, 'content-length': size }); return createReadStream(file).pipe(res); }
  const start = m[1] ? +m[1] : Math.max(0, size - +m[2]), end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
  if (start > end || start >= size) { res.writeHead(416, { 'content-range': `bytes */${size}` }); return res.end(); }
  res.writeHead(206, { ...head, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  createReadStream(file, { start, end }).pipe(res);
}
const VIDEO_MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };

// Plain qwen3-vl:2b/4b are the reasoning variants; newer Ollama lets them reason through every reply instead of
// answering in JSON. Move saved settings to the -instruct tag and show the setup prompt so it can be downloaded.
async function migrateModel() {
  const m = /^qwen3-vl:(\d+b)$/.exec((await api.getSettings()).vision.model);
  if (m) await api.setSettings({ vision: { model: `qwen3-vl:${m[1]}-instruct`, setupSeen: false } });
  // Installs from before the object detector are offered it once, through the same first-launch setup prompt.
  if (!(await api.getSettings()).vision.detectorOffered) await api.setSettings({ vision: { detectorOffered: true, ...(!setup.detectorOk() && { setupSeen: false }) } });
  // ...and once more when the image-search model joined it (only the missing files are downloaded).
  if (!(await api.getSettings()).vision.imageSearchOffered) await api.setSettings({ vision: { imageSearchOffered: true, ...(!setup.detectorOk() && { setupSeen: false }) } });
}

// Live feeds and archive imports (sources.mjs). Directory cameras arrive with their public URLs; any URL is limited to
// http(s)/rtsp and the import extension allow-list, and MEVA keys must match the archive's own file naming.
const validTz = tz => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return tz; } catch { bad('unknown timezone'); } };
const validClipSec = s => { if (!(+s >= 5 && +s <= 300)) bad('clipSec must be 5-300'); return Math.round(+s); };
function validFeeds(b) {
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 100) bad('items must be 1-100 cameras');
  return b.items.map(i => {
    if (!/^(https?|rtsp):\/\/\S+$/.test(i.url || '') || i.url.length > 500) bad('url must be http(s) or rtsp');
    if (!['clip', 'stream'].includes(i.kind)) bad('kind must be clip or stream');
    const intervalMin = +i.intervalMin, clipSec = +(i.clipSec ?? 30);
    if (!(intervalMin >= 2 && intervalMin <= 1440)) bad('intervalMin must be 2-1440');
    if (!(clipSec >= 5 && clipSec <= 300)) bad('clipSec must be 5-300');
    return { name: str(i.name, 80, 'name'), location: str(i.location || 'Unspecified', 120, 'location'), tz: validTz(i.tz), url: i.url, kind: i.kind,
      intervalMin, clipSec, provider: ['tfl', 'caltrans', 'url'].includes(i.provider) ? i.provider : 'url', image: /^https:\/\/\S+$/.test(i.image || '') ? i.image : null };
  });
}
function validImports(b) {
  if (Array.isArray(b.meva)) {
    if (!b.meva.length || b.meva.length > 500) bad('choose 1-500 MEVA clips');
    return sources.mevaItems(b.meva.map(f => {
      if (!/^drops-[\w-]+\/[\w./-]+\.r\d+\.avi$/.test(f.key || '') || f.key.includes('..')) bad('not a MEVA clip');
      const m = f.key.match(/(\d{4}-\d\d-\d\d)\.(\d\d-\d\d-\d\d)\.(\d\d-\d\d-\d\d)\.([\w-]+)\.([\w-]+)\.r\d+\.avi$/);
      if (!m) bad('not a MEVA clip');
      return { key: f.key, size: Number.isFinite(f.size) ? f.size : 0, date: m[1], start: m[2].replace(/-/g, ':'), end: m[3].replace(/-/g, ':'), site: m[4], camera: m[5] };
    }));
  }
  if (!Array.isArray(b.urls) || !b.urls.length || b.urls.length > 200) bad('give 1-200 video URLs');
  const tz = validTz(b.tz), start = iso(b.start, 'start');
  return b.urls.map(u => {
    if (!/^https?:\/\/\S+$/.test(u) || u.length > 500) bad(`not an http(s) URL: ${String(u).slice(0, 80)}`);
    const name = decodeURIComponent(new URL(u).pathname.split('/').pop() || 'video'), ext = (name.match(/\.[a-z0-9]{1,5}$/i)?.[0] || '').toLowerCase();
    if (!VIDEO_EXT.includes(ext)) bad(`Unsupported file type ${ext || '(none)'} in ${name}`);
    const cam = b.camera ? str(b.camera, 80, 'camera') : name.replace(/\.[^.]+$/, '').slice(0, 80);
    return { url: u, name: cam, location: b.location ? str(b.location, 120, 'location') : 'Imported', tz, start, ext, provider: 'url',
      cameraKey: 'url-' + createHash('sha1').update(b.camera ? cam : u).digest('hex').slice(0, 12) };
  });
}
const ingest = () => ({ feeds: sources.listFeeds(), imports: sources.listImports(), backlog: indexer.backlog(), maxBacklog: sources.MAX_BACKLOG, attribution: sources.ATTRIBUTION });

// The active dataset follows settings.source: the demo, or "My footage" rebuilt whenever indexed videos change.
let mine = null, mineKey = null;
async function applySource() {
  const { source, vision, pipeline, day } = await api.getSettings();
  indexer.configure({ model: vision.model, sampling: pipeline.sampling });
  if (source !== 'mine') return api.useDataset(DEMO);
  const key = day + indexer.listVideos().filter(v => v.status === 'ready').map(v => v.id + v.indexedAt).join();
  if (key !== mineKey) { mine = indexer.dataset(day); mineKey = key; }
  api.useDataset(mine);
}

function liveStream(req, res, url) {
  const speed = +(url.searchParams.get('speed') || 60), from = +(url.searchParams.get('from') || api.W[0]);
  if (!(speed >= 1 && speed <= 3600) || !(from >= api.W[0] && from <= api.W[1])) throw new HttpError(400, 'speed 1-3600, from inside the recorded window');
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const ac = new AbortController(), send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  req.on('close', () => ac.abort());
  api.live({ speed, from, signal: ac.signal, onTick: d => send('tick', d), onEvent: d => send('event', d), onAlert: d => send('alert', d) })
    .then(() => { send('end', {}); res.end(); }).catch(() => res.end());
}

const runs = new Map(); // search id -> { events, done, listeners, ac }
function startSearch({ text, scope = 'all', context = null, depth }) {
  if (typeof text !== 'string' || !text.trim() || text.length > 500) bad('text must be 1-500 characters');
  if (scope !== 'all' && !api.camera(scope)) bad('unknown scope');
  if (context && !api.object(context.track)?.name) bad('unknown context track');
  if (depth != null && !api.DEPTHS[depth]) bad('depth must be fast, balanced or deep');
  const id = Math.random().toString(36).slice(2, 10), run = { events: [], done: false, listeners: new Set(), ac: new AbortController() };
  const push = (type, data) => { run.events.push([type, data]); run.listeners.forEach(l => l(type, data)); if (type !== 'stage') run.done = true; };
  const real = api.ds().source === 'mine';   // real footage: no simulated stage delays, and the local model verifies
  (real ? baseline.objectSimilarities(text) : Promise.resolve(null)).then(sim => api.search(text, { scope, context, depth, signal: run.ac.signal, onStage: s => push('stage', s),
    speed: real ? 0 : 1, sim, verify: real ? (e, question) => indexer.verify(e, question) : null }))
    .then(r => push('result', r))
    .catch(e => push(e.name === 'AbortError' ? 'cancelled' : 'fail', { message: e.message }));
  runs.set(id, run);
  setTimeout(() => runs.delete(id), 10 * 60e3).unref();
  return id;
}

const routes = [
  // stale: server code changed on disk since this process started (e.g. after git pull); the launcher restarts it
  ['GET', /^health$/, () => ({ ok: true, mode: 'server', stale: CODE.some(f => statSync(join(root, f)).mtimeMs > BOOT) })],
  ['GET', /^cameras$/, () => api.getCameras()],
  ['GET', /^cameras\/([\w-]+)\/events$/, (_, [id]) => api.getEvents(id)],
  ['GET', /^events$/, () => api.getEvents()],
  ['GET', /^objects\/(\w+)$/, (_, [t]) => { const o = api.object(t); if (!o.name) throw new HttpError(404, 'no such object'); return o; }],
  ['GET', /^journeys\/(\w+)$/, (_, [t]) => api.journey(t)],
  ['GET', /^memory$/, () => api.getMemory()],
  ['POST', /^memory$/, async req => api.createMemory(validRef(await body(req)))],
  ['PUT', /^memory\/([\w-]+)$/, async (req, [id]) => { await api.updateMemory(id, validRef(await body(req), true)); return { ok: true }; }],
  ['DELETE', /^memory\/([\w-]+)$/, async (_, [id]) => { await api.deleteMemory(id); return { ok: true }; }],
  ['GET', /^history$/, () => api.getHistory()],
  ['GET', /^saved$/, () => api.getSaved()],
  ['POST', /^saved$/, async req => {
    const b = await body(req), q = String(b.query ?? '').slice(0, 500);
    if (b.track != null) { if (!api.object(b.track).name) bad('unknown track'); await api.saveJourney(b.track, q); }
    else { if (!api.event(b.eventId)) bad('unknown eventId'); await api.saveEvidence(b.eventId, q); }
    return { ok: true };
  }],
  ['PUT', /^saved\/([\w:%-]+)$/, async (req, [id]) => {
    const b = await body(req);
    if (!api.LANES[b.lane] || !Number.isInteger(b.index) || b.index < 0) bad('lane must be a known lane and index a non-negative integer');
    await api.moveItem(decodeURIComponent(id), b.lane, b.index); return { ok: true };
  }],
  ['DELETE', /^saved\/([\w:%-]+)$/, async (_, [id]) => { await api.removeEvidence(decodeURIComponent(id)); return { ok: true }; }],
  ['GET', /^notes$/, async () => ({ text: await api.getNotes() })],
  ['PUT', /^notes$/, async req => { const b = await body(req); if (typeof b.text !== 'string' || b.text.length > 20000) bad('text must be a string under 20k'); await api.setNotes(b.text); return { ok: true }; }],
  ['GET', /^settings$/, () => api.getSettings()],
  ['PUT', /^settings$/, async req => api.setSettings(validSettings(await body(req)))],
  ['GET', /^audit$/, () => api.getAudit()],
  ['POST', /^audit$/, async req => {
    const b = await body(req);
    if (b.action !== 'reveal' || !api.event(b.eventId)) bad('only reveal of a known eventId is audited');
    return api.addAudit({ action: 'reveal', eventId: b.eventId, role: (await api.getSettings()).operator.role }); // api enforces the role (403)
  }],
  ['GET', /^dataset$/, () => api.ds()],
  ['GET', /^sources\/tfl$/, () => sources.tfl()],
  ['GET', /^sources\/caltrans\/(\d{1,2})$/, (_, [d]) => { if (!sources.DISTRICTS[d]) bad('district must be 1-12'); return sources.caltrans(+d); }],
  ['GET', /^sources\/meva$/, (_, __, url) => {
    const p = url.searchParams.get('prefix') || 'drops-123-r13/';
    if (!/^drops-[\w./-]*$/.test(p) || p.includes('..')) bad('not a MEVA folder');
    return sources.meva(p);
  }],
  ['GET', /^ingest$/, () => ingest()],
  // the comparison baseline (baseline.mjs): CLIP frame retrieval over the same footage
  ['POST', /^baseline\/search$/, async req => { const b = await body(req); if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 500) bad('text must be 1-500 characters'); return baseline.baselineSearch(b.text, { k: Math.min(50, Math.max(1, +b.k || 10)), scope: b.scope || 'all' }); }],
  ['POST', /^feeds$/, async req => ({ added: sources.addFeeds(validFeeds(await body(req))).length, ...ingest() })],
  ['PUT', /^feeds\/([\w-]+)$/, async (req, [id]) => {
    const b = await body(req), patch = {};
    if ('active' in b) { if (typeof b.active !== 'boolean') bad('active must be boolean'); patch.active = b.active; patch.state = b.active ? 'Resumed' : 'Paused'; }
    if ('intervalMin' in b) { if (!(+b.intervalMin >= 2 && +b.intervalMin <= 1440)) bad('intervalMin must be 2-1440'); patch.intervalMin = +b.intervalMin; }
    if ('clipSec' in b) patch.clipSec = validClipSec(b.clipSec);
    sources.updateFeed(id, patch); return ingest();
  }],
  ['POST', /^feeds\/([\w-]+)\/capture$/, async (req, [id]) => { const b = await body(req); sources.captureNow(id, b.clipSec == null ? null : validClipSec(b.clipSec)); return ingest(); }],
  ['DELETE', /^feeds\/([\w-]+)$/, (_, [id]) => { sources.removeFeed(id); return ingest(); }],
  ['POST', /^imports$/, async req => { sources.addImports(validImports(await body(req))); return ingest(); }],
  ['DELETE', /^imports$/, () => { sources.clearImports(); return ingest(); }],
  ['GET', /^videos$/, () => indexer.listVideos()],
  ['POST', /^videos$/, (req, _, url) => indexer.addVideo(req, validUpload(url.searchParams, (req.headers['content-type'] || '').split(';')[0].trim()))],
  ['POST', /^videos\/([\w-]+)\/reindex$/, (_, [id]) => { indexer.reindex(id); return { ok: true }; }],
  ['DELETE', /^videos\/([\w-]+)$/, (_, [id]) => { indexer.removeVideo(id); return { ok: true }; }],
  ['GET', /^setup$/, async () => setup.status((await api.getSettings()).vision.model)],
  ['POST', /^setup\/install$/, async req => {
    const b = await body(req);
    return setup.install({ ffmpeg: b.ffmpeg === true, ollama: b.ollama === true, model: b.model == null ? null : validModel(b.model), detector: b.detector === true });
  }],
  ['GET', /^watches$/, () => api.getWatches()],
  ['POST', /^watches$/, async req => api.createWatch(validWatch(await body(req)))],
  ['PUT', /^watches\/([\w-]+)$/, async (req, [id]) => { await api.updateWatch(id, validWatch(await body(req), true)); return { ok: true }; }],
  ['DELETE', /^watches\/([\w-]+)$/, async (_, [id]) => { await api.deleteWatch(id); return { ok: true }; }],
  ['GET', /^alerts$/, () => api.getAlerts()],
  ['POST', /^search$/, async req => ({ id: startSearch(await body(req)) })],
  ['DELETE', /^search\/(\w+)$/, (_, [id]) => { runs.get(id)?.ac.abort(); return { ok: true }; }],
];

function sse(res, id) {
  const run = runs.get(id);
  if (!run) throw new HttpError(404, 'unknown search');
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  const send = (type, data) => { res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); if (type !== 'stage') res.end(); };
  run.events.forEach(([t, d]) => send(t, d));
  if (run.done) return;
  run.listeners.add(send);
  res.on('close', () => run.listeners.delete(send));
}

function serveStatic(res, path) {
  const rel = normalize(decodeURIComponent(path === '/' ? '/index.html' : path)).replace(/^[\\/]+/, '');
  const file = join(root, rel);
  if (!file.startsWith(root + sep) || rel.split(/[\\/]/).some(p => p.startsWith('.')) || !existsSync(file) || !statSync(file).isFile()) throw new HttpError(404, 'Not found');
  res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
  // Mark the page so the client uses this backend without probing (a probe would 404 on static hosting).
  if (rel === 'index.html') return res.end(readFileSync(file, 'utf8').replace('<head>', '<head>\n  <meta name="vi-backend" content="server">'));
  createReadStream(file).pipe(res);
}

// Binds to loopback by default: the app has no sign-in, so it must not be reachable from the network.
// Browser-facing guards for a loopback server with no sign-in:
// - Host must be loopback (stops DNS-rebinding pages from reading the API)
// - writes must not come from another origin, and a POST must carry a non-"simple" content type, which forces a
//   CORS preflight this server never approves (stops cross-site form/fetch POSTs)
const LOOP = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const SIMPLE = ['', 'text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data'];
function guard(req) {
  if (!LOOP.test(req.headers.host || '')) throw new HttpError(421, 'Unexpected Host header');
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (origin && origin !== 'null' && !LOOP.test(new URL(origin).host)) throw new HttpError(403, 'Cross-origin write refused');
  if (origin === 'null') throw new HttpError(403, 'Cross-origin write refused');
  if (req.method === 'POST' && SIMPLE.includes((req.headers['content-type'] || '').split(';')[0].trim().toLowerCase())) throw new HttpError(415, 'Send JSON (or video) with a content-type');
}

export const activity = { busy: () => !!setup.busy() || indexer.busy() || sources.busy() }; // idle exit waits for installs and indexing

export function start(port = 0, storeFile = join(root, '.store', 'store.json'), host = '127.0.0.1') {
  api.useStorage(fileStore(storeFile));
  indexer.useStorage(api.kv.load, api.kv.save);
  sources.useStorage(api.kv.load, api.kv.save);
  sources.startScheduler();
  indexer.useStoreDir(dirname(storeFile));
  migrateModel().then(applySource).then(indexer.resume);   // continue any indexing interrupted by a restart
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      guard(req);
      if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
      const path = url.pathname.slice(5), m = path.match(/^search\/(\w+)\/events$/);
      let f;
      if (req.method === 'GET' && (f = path.match(/^videos\/([\w-]+)\/(file|play)$/))) {
        const v = indexer.listVideos().find(x => x.id === f[1]);
        if (!v) throw new HttpError(404, 'Not found');
        // play: the H.264 copy when one was made (source codec not browser-playable), else the source itself
        if (f[2] === 'play' && existsSync(indexer.playFile(v))) return sendFile(req, res, indexer.playFile(v), 'video/mp4');
        return sendFile(req, res, indexer.videoFile(v), VIDEO_MIME[extname(v.file)] || 'application/octet-stream');
      }
      if (req.method === 'GET' && (f = path.match(/^videos\/([\w-]+)\/frames\/(\d+)$/))) return sendFile(req, res, indexer.frameFile(f[1], +f[2]), 'image/jpeg');
      await applySource();
      if (m && req.method === 'GET') return sse(res, m[1]);
      if (path === 'live' && req.method === 'GET') return liveStream(req, res, url);
      for (const [method, re, fn] of routes) {
        const hit = path.match(re);
        if (hit && method === req.method) {
          const out = await fn(req, hit.slice(1), url);
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify(out));
        }
      }
      throw new HttpError(404, `No route ${req.method} /api/${path}`);
    } catch (e) {
      if (res.headersSent) return res.end();
      res.writeHead(e.status || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: e.status ? e.message : 'Internal error' }));
      if (!e.status) console.error(e);
    }
  });
  return new Promise(r => server.listen(port, host, () => {
    // Also answer on IPv6 loopback: Windows tries ::1 first for "localhost" and waits ~2 s on a refusal.
    if (host === '127.0.0.1') {
      const v6 = createServer((req, res) => server.emit('request', req, res)).on('error', () => {});
      v6.listen(server.address().port, '::1');
      server.on('close', () => v6.close());
    }
    r(server);
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  // VI_LOG: started windowless by Video Intelligence.exe, so there is no console; write logs to a file instead.
  if (process.env.VI_LOG) {
    const log = (await import('node:fs')).createWriteStream(process.env.VI_LOG, { flags: 'a' });
    console.log = console.error = console.warn = (...a) => log.write(`${new Date().toISOString()} ${a.join(' ')}\n`);
    process.on('uncaughtException', e => { console.error(e.stack); process.exit(1); });
  }
  const s = await start(+process.env.PORT || 8000, process.env.VI_STORE, process.env.HOST || '127.0.0.1');
  console.log(`video-intel on http://localhost:${s.address().port}`);
  // VI_IDLE_EXIT=<ms>: set when the app icon starts the server in the background. Exit once nothing has
  // talked to it for that long (the open app pings every minute), so closing the window stops the server.
  const idle = +process.env.VI_IDLE_EXIT;
  if (idle) {
    let last = Date.now(), open = 0;
    s.on('request', (req, res) => { open++; last = Date.now(); res.on('close', () => { open--; last = Date.now(); }); });
    setInterval(() => {
      if (activity.busy()) last = Date.now();
      if (!open && Date.now() - last > idle) { console.log('idle, exiting'); process.exit(0); }
    }, Math.min(idle, 15e3));
  }
}
