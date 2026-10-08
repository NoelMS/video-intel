// Free, keyless public footage: live camera directories (TfL London, Caltrans California), the MEVA multi-camera
// archive, and any HLS/RTSP/MP4 URL. Feeds capture a clip on a schedule while the app is open; imports download archive
// clips. Both hand files to the indexer, grouped per camera with a stable cameraKey.
import { createHash } from 'node:crypto';
import { createWriteStream, rmSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as setup from './setup.mjs';
import * as indexer from './indexer.mjs';
import { inSchedule, interpret } from './api.js';

let load = () => [], save = () => {};
export const useStorage = (l, s) => { load = l; save = s; };
const key = s => createHash('sha1').update(s).digest('hex').slice(0, 12);
const getJson = async url => { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); };

// ---------- directories ----------
// TfL JamCams: ~890 London traffic cameras; each publishes a ~10 s MP4 that is replaced every few minutes.
export const ATTRIBUTION = {
  tfl: 'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights.',
  caltrans: 'Caltrans CCTV, California Department of Transportation.',
  meva: 'MEVA dataset (Kitware / IARPA), CC BY 4.0.',
};
const cache = new Map();
const cached = async (k, ms, fn) => { const c = cache.get(k); if (c && Date.now() - c.at < ms) return c.v; const v = await fn(); cache.set(k, { at: Date.now(), v }); return v; };

export const tfl = () => cached('tfl', 600e3, async () => (await getJson('https://api.tfl.gov.uk/Place/Type/JamCam')).map(c => {
  const p = Object.fromEntries(c.additionalProperties.map(x => [x.key, x.value]));
  return { id: c.id, name: c.commonName, view: p.view, image: p.imageUrl, url: p.videoUrl, available: p.available === 'true' };
}).filter(c => c.url));

// Caltrans: live HLS per camera, published per district (1-12).
export const DISTRICTS = { 1: 'Eureka', 2: 'Redding', 3: 'Sacramento', 4: 'San Francisco Bay Area', 5: 'San Luis Obispo', 6: 'Fresno', 7: 'Los Angeles',
  8: 'San Bernardino', 9: 'Bishop', 10: 'Stockton', 11: 'San Diego', 12: 'Orange County' };
export const caltrans = d => cached('ct' + d, 900e3, async () => {
  const dd = String(d).padStart(2, '0');
  return (await getJson(`https://cwwp2.dot.ca.gov/data/d${d}/cctv/cctvStatusD${dd}.json`)).data.map(x => x.cctv)
    .filter(c => c.inService === 'true' && c.imageData?.streamingVideoURL)
    .map(c => ({ id: `ct${d}-${c.index}`, name: c.location.locationName.trim(), view: c.location.nearbyPlace || c.location.county,
      image: c.imageData.static?.currentImageURL, url: c.imageData.streamingVideoURL }));
});

// MEVA: ~330 h from 29 cameras at one site; clips are <date>.<start>.<end>.<site>.<camera>.r13.avi in a public bucket.
const MEVA = 'https://mevadata-public-01.s3.amazonaws.com/';
export const MEVA_TZ = 'America/Indiana/Indianapolis';
export const meva = prefix => cached('meva' + prefix, 3600e3, async () => {
  const dirs = [], files = [];
  let token = '';
  do {
    const x = await (await fetch(`${MEVA}?list-type=2&delimiter=/&prefix=${encodeURIComponent(prefix)}${token ? '&continuation-token=' + encodeURIComponent(token) : ''}`)).text();
    dirs.push(...[...x.matchAll(/<CommonPrefixes><Prefix>([^<]+)<\/Prefix>/g)].map(m => m[1]));
    for (const [, k, size] of x.matchAll(/<Key>([^<]+)<\/Key>.*?<Size>(\d+)<\/Size>/g)) {
      const m = k.match(/(\d{4}-\d\d-\d\d)\.(\d\d-\d\d-\d\d)\.(\d\d-\d\d-\d\d)\.([\w-]+)\.([\w-]+)\.r\d+\.avi$/);
      if (m) files.push({ key: k, size: +size, date: m[1], start: m[2].replace(/-/g, ':'), end: m[3].replace(/-/g, ':'), site: m[4], camera: m[5] });
    }
    token = x.match(/<NextContinuationToken>([^<]+)</)?.[1] || '';
  } while (token);
  return { prefix, dirs, files };
});

// Local wall-clock time in a timezone -> UTC ISO (MEVA filenames are site-local).
export function localToUtc(date, time, tz) {
  const naive = Date.parse(`${date}T${time}Z`);
  const offset = at => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(at)).map(x => [x.type, x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - at;
  };
  return new Date(naive - offset(naive - offset(naive))).toISOString();
}

// ---------- live feeds ----------
// kind 'clip': the URL is a short MP4 the camera replaces (TfL); fetched when it changed (If-Modified-Since).
// kind 'stream': HLS or RTSP; ffmpeg records clipSec seconds per capture.
export const listFeeds = () => load('vi.feeds', []);
const putFeed = f => save('vi.feeds', listFeeds().map(x => x.id === f.id ? f : x));
export function addFeeds(items) {
  const have = new Set(listFeeds().map(f => f.url)), now = Date.now();
  const added = items.filter(i => !have.has(i.url)).map((i, k) => ({ id: 'f_' + key(i.url + now), cameraKey: 'feed-' + key(i.url), active: true,
    next: now + k * 5000, last: null, lastError: null, state: 'Waiting for first capture', captures: 0, lastModified: null, ...i }));
  save('vi.feeds', [...listFeeds(), ...added]);
  return added;
}
export const updateFeed = (id, patch) => save('vi.feeds', listFeeds().map(f => f.id === id ? { ...f, ...patch, ...(patch.active || patch.fast ? { next: Date.now() } : {}) } : f));

// Fast capture: a clip camera is polled every FAST_SEC (an unchanged TfL clip is a free 304) and a stream records
// continuously. On while "Start capture" is on, or while an active standing query covering the camera is in its hours
// (watch hours are this computer's clock, like the dataset's).
const FAST_SEC = 30;
const nowSec = () => { const d = new Date(); return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(); };
// A query that names a place only speeds up the camera that place was defined on: the demo's standing queries ("the
// rear entrance", "the loading area", on demo cameras) otherwise put every real camera on fast capture each morning.
const covers = (w, f, refs) => { const q = interpret(w.text, refs, null); return !q.location || q.location.ref?.cameraId === f.cameraKey; };
export const fastWhy = f => f.fast ? 'started manually'
  : load('vi.watches', []).some(w => w.status === 'active' && (w.scope === 'all' || w.scope === f.cameraKey) && inSchedule(nowSec(), w) && covers(w, f, load('vi.memory', []))) ? 'standing query hours' : null;
const recording = f => f.active && f.kind === 'stream' && (f.continuous || !!fastWhy(f));
const due = f => f.next <= Date.now() || (fastWhy(f) && f.next > Date.now() + FAST_SEC * 1e3);
export const removeFeed = id => save('vi.feeds', listFeeds().filter(f => f.id !== id));   // clips already indexed stay

export const MAX_BACKLOG = 12;   // captures pause while this many clips wait for the model, rather than queueing forever
const capturing = new Set();
async function tick() {
  for (const f of listFeeds().filter(f => f.active && !recording(f) && due(f) && !capturing.has(f.id))) {
    if (indexer.backlog().clips >= MAX_BACKLOG) { putFeed({ ...f, state: 'Paused while the indexing backlog clears', next: Date.now() + 60e3 }); continue; }
    captureFeed(f);
  }
}
// The next timed capture counts from this one, so a forced capture does not get a second clip straight after it.
function captureFeed(f, clipSec = null) {
  capturing.add(f.id);
  putFeed({ ...f, capturing: true, state: 'Capturing…' });
  return capture(clipSec ? { ...f, clipSec } : f).catch(e => ({ lastError: e.message, state: 'Capture failed; retrying next interval' }))
    .then(patch => { const cur = listFeeds().find(x => x.id === f.id); if (cur) putFeed({ ...cur, ...patch, capturing: false, next: Date.now() + (fastWhy(cur) ? FAST_SEC * 1e3 : cur.intervalMin * 60e3) }); })
    .finally(() => capturing.delete(f.id));
}
// "Capture now": also on a paused camera, and past the backlog limit, since someone asked for it. clipSec sets this
// capture's length on a stream (a TfL camera's clip is whatever ~10 s it published). A TfL camera only publishes a new
// clip every minute or so, so forcing it early can still answer "No new clip since the last capture".
export function captureNow(id, clipSec = null) {
  const f = listFeeds().find(x => x.id === id);
  if (!f) throw Object.assign(new Error('No such camera'), { status: 404 });
  if (!capturing.has(id)) captureFeed(f, f.kind === 'stream' ? clipSec : null);
}
let timer = null;
export const startScheduler = () => { timer ??= setInterval(() => { tick(); recordContinuously(); }, 15e3); timer.unref?.(); tick(); recordContinuously(); };

// ---------- continuous recording (stream cameras with `continuous`) ----------
// One ffmpeg per camera cuts the stream into clipSec segments (stream copy, so it costs almost nothing); each finished
// segment is queued for indexing as its own clip of that camera. Indexing a busy scene runs slower than real time on a
// 4 GB GPU, so while the backlog is full, finished segments are dropped and counted (they show as coverage gaps).
const recorders = new Map();   // feed id -> { proc, dir, dropped, queued, err }
function recordContinuously() {
  const feeds = listFeeds();
  for (const f of feeds) {
    const on = recording(f), r = recorders.get(f.id);
    if (on && !r) startRecorder(f);
    else if (!on && r) stopRecorder(f.id);
    else if (r) queueSegments(f, r);
  }
  for (const id of recorders.keys()) if (!feeds.some(f => f.id === id)) stopRecorder(id);
}
function startRecorder(f) {
  const dir = join(tmpdir(), `vi-live-${f.id}`);
  mkdirSync(dir, { recursive: true });   // kept across reconnects: finished segments still in it are queued as usual
  // -nostdin: with no console to read, ffmpeg otherwise stops after a segment or two
  const proc = spawn(setup.ffmpegPath(), ['-hide_banner', '-nostdin', '-loglevel', 'error', ...(f.url.startsWith('rtsp') ? ['-rtsp_transport', 'tcp'] : ['-rw_timeout', '20000000']), '-i', f.url,
    '-map', '0:v:0', '-c', 'copy', '-f', 'segment', '-segment_time', String(f.clipSec), '-reset_timestamps', '1', '-strftime', '1', join(dir, '%Y%m%d_%H%M%S.mp4')],
  { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  const r = { proc, dir, dropped: 0, queued: new Set(), err: '' };
  proc.stderr.on('data', d => { r.err = (r.err + d).slice(-300); });
  recorders.set(f.id, r);
  proc.on('exit', () => {
    if (recorders.get(f.id) !== r) return;
    recorders.delete(f.id);
    const cur = listFeeds().find(x => x.id === f.id);
    if (cur && recording(cur)) putFeed({ ...cur, state: 'Stream dropped; reconnecting', lastError: r.err.trim().split('\n').at(-1) || null });
  });
  putFeed({ ...f, state: `Recording continuously in ${f.clipSec} s segments` });
}
function stopRecorder(id) { const r = recorders.get(id); recorders.delete(id); r?.proc.kill(); if (r) setTimeout(() => rmSync(r.dir, { recursive: true, force: true }), 2000); }
process.on('exit', () => { for (const r of recorders.values()) r.proc.kill(); });
function queueSegments(f, r) {
  const files = readdirSync(r.dir).filter(n => /^\d{8}_\d{6}\.mp4$/.test(n)).sort();
  for (const n of files.slice(0, -1).filter(n => !r.queued.has(n))) {   // the newest file is still being written
    const file = join(r.dir, n);
    r.queued.add(n);
    if (statSync(file).size < 1000) { rmSync(file, { force: true }); continue; }   // ffmpeg leaves an empty segment when a stream stalls
    if (indexer.backlog().clips >= MAX_BACKLOG) { rmSync(file, { force: true }); r.dropped++; continue; }
    // A segment ends when ffmpeg last wrote it, so it starts its length before that. (Its file name is when ffmpeg
    // opened it, which is wrong for the burst of buffered video a live stream sends on connecting.)
    const ended = statSync(file).mtimeMs;
    indexer.probe(file).then(({ duration }) => indexer.addVideoFile(file, { name: f.name, location: f.location, tz: f.tz, cameraKey: f.cameraKey, neighbors: [], labels: [], ext: '.mp4',
      source: { provider: f.provider, url: f.url }, start: new Date(ended - duration * 1000).toISOString() }))
      .then(() => { const cur = listFeeds().find(x => x.id === f.id); if (cur) putFeed({ ...cur, captures: cur.captures + 1, last: new Date().toISOString(), lastError: null, state: `Recording continuously in ${f.clipSec} s segments${r.dropped ? ` · ${r.dropped} dropped while indexing caught up` : ''}` }); })
      .catch(e => { rmSync(file, { force: true }); const cur = listFeeds().find(x => x.id === f.id); if (cur) putFeed({ ...cur, lastError: e.message }); });
  }
}

const tmp = ext => join(tmpdir(), `vi-capture-${Date.now()}-${Math.random().toString(36).slice(2, 6)}${ext}`);
const ffmpeg = (args, ms) => new Promise((res, rej) => {
  const p = spawn(setup.ffmpegPath(), args, { windowsHide: true }); let err = '';
  const kill = setTimeout(() => p.kill(), ms);
  p.stderr.on('data', d => err = (err + d).slice(-600));
  p.on('error', rej).on('exit', c => { clearTimeout(kill); c ? rej(new Error(err.trim().split('\n').at(-1) || `ffmpeg exit ${c}`)) : res(); });
});

async function capture(f) {
  const file = tmp('.mp4'), meta = { name: f.name, location: f.location, tz: f.tz, cameraKey: f.cameraKey, neighbors: [], labels: [], ext: '.mp4',
    source: { provider: f.provider, url: f.url } };
  try {
    if (f.kind === 'clip') {
      const r = await fetch(f.url, { headers: f.lastModified ? { 'if-modified-since': f.lastModified } : {}, signal: AbortSignal.timeout(60000) });
      if (r.status === 304) return { state: 'No new clip since the last capture', lastError: null };
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (+r.headers.get('content-length') > 200e6) throw new Error('Clip larger than 200 MB');
      await pipeline(Readable.fromWeb(r.body), createWriteStream(file));
      const { duration } = await indexer.probe(file);
      // TfL replaces the video with a ~1 s grey card ("Camera ... in use keeping London moving") while it controls the
      // camera; real JamCam clips are ~10 s. Nothing to index.
      if (f.provider === 'tfl' && duration < 2) return { lastModified: r.headers.get('last-modified'), state: 'Camera unavailable: TfL is using it', lastError: null };
      const end = Date.parse(r.headers.get('last-modified')) || Date.now();
      await indexer.addVideoFile(file, { ...meta, start: new Date(end - duration * 1000).toISOString() });
      return { lastModified: r.headers.get('last-modified'), last: new Date().toISOString(), captures: f.captures + 1, state: 'Captured', lastError: null };
    }
    const start = new Date().toISOString();
    await ffmpeg(['-hide_banner', '-y', ...(f.url.startsWith('rtsp') ? ['-rtsp_transport', 'tcp'] : ['-rw_timeout', '20000000']), '-i', f.url,
      '-t', String(f.clipSec), '-map', '0:v:0', '-c', 'copy', '-f', 'mp4', file], (f.clipSec + 90) * 1000);
    if (!(statSync(file).size > 1000)) throw new Error('The stream sent no video');
    await indexer.addVideoFile(file, { ...meta, start });
    return { last: new Date().toISOString(), captures: f.captures + 1, state: 'Captured', lastError: null };
  } finally { rmSync(file, { force: true }); }
}

// ---------- archive imports ----------
let imports = [];
let importing = false;
export const listImports = () => imports;
export function addImports(items) {
  const now = Date.now();
  imports.push(...items.map((i, k) => ({ id: 'i_' + key(i.url + now + k), state: 'queued', done: 0, total: i.size || 0, error: null, ...i })));
  runImports();
  return imports;
}
export const clearImports = () => { imports = imports.filter(i => ['queued', 'downloading'].includes(i.state)); };
async function runImports() {
  if (importing) return;
  importing = true;
  try {
    for (let i; (i = imports.find(x => x.state === 'queued'));) {
      i.state = 'downloading';
      const file = tmp(i.ext);
      try {
        await setup.download(i.url, file, i);          // resumes dropped connections; i.done/i.total are its progress
        await indexer.addVideoFile(file, { name: i.name, location: i.location, tz: i.tz, start: i.start, cameraKey: i.cameraKey, neighbors: [], labels: [], ext: i.ext,
          source: { provider: i.provider, url: i.url } });
        i.state = 'done';
      } catch (e) { i.state = 'failed'; i.error = e.message; }
      finally { rmSync(file, { force: true }); }
    }
  } finally { importing = false; }
}
export const busy = () => importing || capturing.size > 0 || recorders.size > 0;

// MEVA selection -> import items (camera = the G-number, so each MEVA camera is one camera here).
export const mevaItems = files => files.map(f => ({ url: MEVA + f.key, size: f.size, name: `MEVA ${f.camera}`, location: `${f.site} · Muscatatuck, Indiana`,
  tz: MEVA_TZ, start: localToUtc(f.date, f.start, MEVA_TZ), cameraKey: 'meva-' + f.camera, ext: '.avi', provider: 'meva' }));
