// Optional backend: static files + the §90 REST endpoints + SSE search stages, persisted to a JSON file.
// No dependencies. `node server.mjs` (PORT, VI_STORE env vars optional).
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, createReadStream, statSync } from 'node:fs';
import { join, normalize, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from './api.js';

const root = dirname(fileURLToPath(import.meta.url));
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
function validReg(b) {
  const out = { name: str(b.name, 80, 'name'), location: str(b.location, 120, 'location'), tz: str(b.tz, 64, 'tz') };
  try { new Intl.DateTimeFormat('en', { timeZone: out.tz }); } catch { bad('unknown timezone'); }
  const s = b.source || {};
  if (s.kind === 'file') out.source = { kind: 'file', name: str(s.name, 200, 'source.name'), size: Number.isFinite(s.size) && s.size >= 0 ? s.size : bad('source.size'), type: typeof s.type === 'string' ? s.type.slice(0, 100) : '' };
  else if (s.kind === 'url') { if (!/^(https?|rtsp):\/\/\S+$/.test(s.url || '') || s.url.length > 500) bad('source.url must be http(s) or rtsp'); out.source = { kind: 'url', url: s.url }; }
  else bad('source.kind must be file or url');
  out.start = iso(b.start, 'start');
  if (b.end != null) { out.end = iso(b.end, 'end'); if (out.end <= out.start) bad('end must be after start'); }
  out.neighbors = Array.isArray(b.neighbors) ? b.neighbors.map(n => api.camera(n) ? n : bad(`unknown neighbor ${n}`)) : [];
  out.labels = Array.isArray(b.labels) ? b.labels.slice(0, 10).map(l => str(l, 60, 'label')) : [];
  if (b.video != null) {
    const v = b.video;
    if (!(v.duration > 0) || !Number.isInteger(v.width) || !Number.isInteger(v.height)) bad('video needs duration, width, height');
    out.video = { duration: v.duration, width: v.width, height: v.height };
  }
  out.thumbs = Array.isArray(b.thumbs) ? b.thumbs.slice(0, 12).map(t => typeof t === 'string' && t.startsWith('data:image/jpeg;base64,') && t.length < 80000 ? t : bad('thumbs must be small JPEG data URLs')) : [];
  return out;
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
  api.search(text, { scope, context, depth, signal: run.ac.signal, onStage: s => push('stage', s) })
    .then(r => push('result', r))
    .catch(e => push(e.name === 'AbortError' ? 'cancelled' : 'fail', { message: e.message }));
  runs.set(id, run);
  setTimeout(() => runs.delete(id), 10 * 60e3).unref();
  return id;
}

const routes = [
  ['GET', /^health$/, () => ({ ok: true, mode: 'server' })],
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
  ['GET', /^registrations$/, () => api.getRegistered()],
  ['POST', /^registrations$/, async req => api.registerCamera(validReg(await body(req)))],
  ['DELETE', /^registrations\/([\w-]+)$/, async (_, [id]) => { await api.deleteRegistered(id); return { ok: true }; }],
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
export function start(port = 0, storeFile = join(root, '.store', 'store.json'), host = '127.0.0.1') {
  api.useStorage(fileStore(storeFile));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    try {
      if (!url.pathname.startsWith('/api/')) return serveStatic(res, url.pathname);
      const path = url.pathname.slice(5), m = path.match(/^search\/(\w+)\/events$/);
      if (m && req.method === 'GET') return sse(res, m[1]);
      if (path === 'live' && req.method === 'GET') return liveStream(req, res, url);
      for (const [method, re, fn] of routes) {
        const hit = path.match(re);
        if (hit && method === req.method) {
          const out = await fn(req, hit.slice(1));
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
  const s = await start(+process.env.PORT || 8000, process.env.VI_STORE, process.env.HOST || '127.0.0.1');
  console.log(`video-intel on http://localhost:${s.address().port}`);
  // VI_IDLE_EXIT=<ms>: set when the app icon starts the server in the background. Exit once nothing has
  // talked to it for that long (the open app pings every minute), so closing the window stops the server.
  const idle = +process.env.VI_IDLE_EXIT;
  if (idle) {
    let last = Date.now(), open = 0;
    s.on('request', (req, res) => { open++; last = Date.now(); res.on('close', () => { open--; last = Date.now(); }); });
    setInterval(() => { if (!open && Date.now() - last > idle) { console.log('idle, exiting'); process.exit(0); } }, Math.min(idle, 15e3));
  }
}
