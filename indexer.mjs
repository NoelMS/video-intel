// Indexes your recordings: ffmpeg samples frames (dropping near-duplicates), a local Ollama vision model describes
// each frame, detections are linked into tracks, tracks become events in the same shape as the demo data, and
// tracks on different cameras that look alike are linked as possible journeys. All local.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import * as setup from './setup.mjs';

const root = dirname(fileURLToPath(import.meta.url));
let STORE = join(root, '.store');
const dirs = () => ({ videos: join(STORE, 'videos'), frames: join(STORE, 'frames') });
export const useStoreDir = d => { STORE = d; };

let load = () => [], save = () => {};
export const useStorage = (l, s) => { load = l; save = s; };          // server passes api's storage helpers
export const listVideos = () => load('vi.videos', []);
const put = v => save('vi.videos', listVideos().map(x => x.id === v.id ? v : x));
const get = id => listVideos().find(v => v.id === id);
export const videoFile = v => join(dirs().videos, v.file);
// Browser-playable copy, only made when the source codec or container is one browsers cannot play (H.265, DivX, mkv...)
export const playFile = v => join(dirs().videos, v.id + '.play.mp4');
const PLAYABLE = v => /^(h264|vp8|vp9|av1)$/.test(v.codec) && /\.(mp4|m4v|webm|mov)$/i.test(v.file);
export const frameFile = (id, n) => join(dirs().frames, id, `${String(n).padStart(6, '0')}.jpg`);
const detFile = id => join(dirs().frames, id, 'detections.json');

// ---------- ingest ----------
const run = (exe, args, onErrLine) => new Promise((res, rej) => {
  const p = spawn(exe, args, { windowsHide: true });
  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => { err += d; if (onErrLine) for (const l of String(d).split(/[\r\n]+/)) onErrLine(l); });
  p.on('error', rej).on('exit', code => code ? rej(new Error(err.split('\n').filter(Boolean).slice(-2).join(' ') || `exit ${code}`)) : res(out));
});

export async function probe(file) {
  const out = JSON.parse(await run(setup.ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', file]));
  const s = out.streams?.[0];
  if (!s || !(+out.format?.duration > 0)) throw new Error('No playable video stream found');
  return { duration: +out.format.duration, width: s.width, height: s.height, codec: s.codec_name };
}

// Stream an upload to disk, probe it, queue it. meta is validated by the server.
export async function addVideo(req, meta) {
  if (!setup.ffmpegPath()) throw Object.assign(new Error('ffmpeg is not installed. Open System → Local analysis.'), { status: 409 });
  const id = 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  mkdirSync(dirs().videos, { recursive: true });
  const v = { id, ...meta, file: id + meta.ext, status: 'queued', progress: { done: 0, total: 0 }, error: null, added: new Date().toISOString() };
  delete v.ext;
  await pipeline(req, createWriteStream(videoFile(v)));
  try { Object.assign(v, await probe(videoFile(v)), { size: statSync(videoFile(v)).size }); }
  catch (e) { rmSync(videoFile(v), { force: true }); throw Object.assign(new Error(`${meta.name}: ${e.message}`), { status: 422 }); }
  save('vi.videos', [...listVideos(), v]);
  kick();
  return v;
}

export function removeVideo(id) {
  const v = get(id);
  if (!v) return;
  if (current?.id === id) current.cancelled = true;
  rmSync(videoFile(v), { force: true }); rmSync(playFile(v), { force: true }); rmSync(join(dirs().frames, id), { recursive: true, force: true });
  save('vi.videos', listVideos().filter(x => x.id !== id));
}
// Re-index from scratch, so a new sampling rate or model takes effect.
export function reindex(id) {
  const v = get(id);
  if (!v) return;
  if (current?.id === id) current.cancelled = true;
  rmSync(join(dirs().frames, id), { recursive: true, force: true });
  put({ ...v, status: 'queued', error: null, progress: { done: 0, total: 0 } });
  setTimeout(kick, 0);   // after a cancelled run unwinds
}

// ---------- queue (one video at a time; survives restarts because state is persisted) ----------
let current = null, opts = { model: 'qwen3-vl:2b', sampling: 0.5, describe: null };   // describe: test hook
export const configure = o => { opts = { ...opts, ...o }; };
export const busy = () => !!current;

function kick() {
  if (current) return;
  const next = listVideos().find(v => ['queued', 'transcoding', 'extracting', 'analyzing'].includes(v.status));
  if (!next) return;
  current = { id: next.id, cancelled: false };
  index(next).catch(e => { const v = get(current.id); if (v) put({ ...v, status: 'failed', error: e.message }); })
    .finally(() => { current = null; kick(); });
}
export const resume = kick;

async function index(v) {
  const fdir = join(dirs().frames, v.id);
  // 0. playback: H.264 copy when the browser cannot play the source (written to .tmp first so a cancel never leaves half a file)
  if (!PLAYABLE(v) && !existsSync(playFile(v))) {
    put({ ...v, status: 'transcoding', progress: { done: 0, total: Math.round(v.duration) } });
    const tmp = playFile(v) + '.tmp';
    await run(setup.ffmpegPath(), ['-hide_banner', '-y', '-i', videoFile(v), '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
      '-pix_fmt', 'yuv420p', '-vf', "scale='min(1280,iw)':-2", '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', tmp],
    line => { const m = line.match(/time=(\d+):(\d+):([\d.]+)/); if (m) put({ ...get(v.id), progress: { done: Math.round(+m[1] * 3600 + +m[2] * 60 + +m[3]), total: Math.round(v.duration) } }); });
    if (current.cancelled) return rmSync(tmp, { force: true });
    renameSync(tmp, playFile(v));
  }
  // 1. frames: sample at opts.sampling fps, drop near-identical frames (static CCTV), scale to 768 px wide
  if (!existsSync(join(fdir, 'frames.json'))) {
    put({ ...v, status: 'extracting', progress: { done: 0, total: Math.round(v.duration) } });
    rmSync(fdir, { recursive: true, force: true }); mkdirSync(fdir, { recursive: true });
    const times = [];
    await run(setup.ffmpegPath(), ['-hide_banner', '-nostats', '-i', videoFile(v), '-an',
      '-vf', `fps=${opts.sampling},mpdecimate,scale='min(768,iw)':-2,showinfo`, '-fps_mode', 'vfr', '-q:v', '4', join(fdir, '%06d.jpg')],
    line => {
      const m = line.match(/\bpts_time:\s*([\d.]+)/);
      if (m) { times.push(+m[1]); if (times.length % 10 === 0) put({ ...get(v.id), progress: { done: Math.round(+m[1]), total: Math.round(v.duration) } }); }
    });
    writeFileSync(join(fdir, 'frames.json'), JSON.stringify(times.map((t, i) => ({ n: i + 1, t: +t.toFixed(2) }))));
  }
  const frames = JSON.parse(readFileSync(join(fdir, 'frames.json'), 'utf8'));
  // 2. describe each frame with the vision model (resumable: detections are saved as we go)
  if (!opts.describe && !await setup.ensureOllama()) throw new Error('Ollama is not running. Open System → Local analysis.');
  const dets = existsSync(detFile(v.id)) ? JSON.parse(readFileSync(detFile(v.id), 'utf8')) : [];
  const doneN = new Set(dets.map(d => d.n));
  put({ ...get(v.id), status: 'analyzing', model: opts.model, sampling: opts.sampling, progress: { done: dets.length, total: frames.length } });
  for (const f of frames) {
    if (current.cancelled) return;
    if (doneN.has(f.n)) continue;
    dets.push({ ...f, ...await (opts.describe ?? describeFrame)(readFileSync(frameFile(v.id, f.n)).toString('base64')) });
    if (dets.length % 5 === 0 || dets.length === frames.length) {
      writeFileSync(detFile(v.id), JSON.stringify(dets));
      put({ ...get(v.id), progress: { done: dets.length, total: frames.length } });
    }
  }
  writeFileSync(detFile(v.id), JSON.stringify(dets));
  put({ ...get(v.id), status: 'ready', indexedAt: new Date().toISOString(), progress: { done: frames.length, total: frames.length } });
}

// ---------- the vision model ----------
const BOX = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 };
// Lean on purpose: on a 4 GB GPU every output token costs time. Labels carry colours, clothing and carried items, so
// separate colour/attribute lists only added tokens (measured 5.4 s vs ~45 s a frame with them on qwen3-vl:2b).
// maxItems caps the grammar, so a small model that starts repeating itself still closes valid JSON.
const SCHEMA = {
  type: 'object', required: ['objects', 'faces', 'plates', 'lighting'],
  properties: {
    objects: { type: 'array', maxItems: 12, items: { type: 'object', required: ['type', 'label', 'box', 'action'], properties: {
      type: { enum: ['person', 'vehicle', 'animal', 'bag', 'other'] }, label: { type: 'string' }, box: BOX, action: { type: 'string' } } } },
    faces: { type: 'array', maxItems: 8, items: BOX }, plates: { type: 'array', maxItems: 8, items: BOX },
    lighting: { enum: ['good', 'low', 'night'] },
  },
};
const PROMPT = `Index this CCTV frame. List each person, vehicle, animal and carried bag once: type; a short label naming colours and clothing, carried items or vehicle body type (e.g. "woman in red jacket with black backpack", "white delivery van"); box [x1, y1, x2, y2] in 0-1000 image coordinates; action. Then boxes of clearly visible faces and licence plates, and the lighting. Only what you can see.`;

async function chat(images, prompt, format) {
  const res = await fetch(setup.OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify({
    // num_ctx: one frame plus the prompt is ~1-2K tokens; the model's 256K default would not fit in memory.
    // think: false: Qwen3-VL reasons before answering by default, which costs ~40 s a frame for no gain here.
    model: opts.model, stream: false, format, think: false, keep_alive: '10m', options: { temperature: 0, num_ctx: 4096 },
    messages: [{ role: 'user', content: prompt, images }] }) });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  // With a schema, Ollama 0.31 returns this model's JSON in `thinking` and leaves `content` empty; accept either.
  const m = (await res.json()).message;
  return JSON.parse(m.content?.trim() || m.thinking);
}

// 0-1000 corner boxes -> [x, y, w, h] in the app's 640x360 frame space
const toFrame = b => {
  const [x1, y1, x2, y2] = b.map(n => Math.min(1000, Math.max(0, +n || 0)));
  const [a, c] = [Math.min(x1, x2), Math.max(x1, x2)], [bb, d] = [Math.min(y1, y2), Math.max(y1, y2)];
  return [a * 0.64, bb * 0.36, (c - a) * 0.64, (d - bb) * 0.36].map(n => +n.toFixed(1));
};

// Small models sometimes list one object twice; same type with heavily overlapping boxes is the same object.
const dedupe = os => os.filter((o, i) => !os.slice(0, i).some(p => p.type === o.type && iou(p.box, o.box) > 0.7));

export async function describeFrame(b64) {
  const r = await chat([b64], PROMPT, SCHEMA);
  return {
    objects: dedupe((r.objects || []).map(o => ({ ...o, box: toFrame(o.box) })).filter(o => o.box[2] > 2 && o.box[3] > 2)),
    faces: (r.faces || []).map(toFrame), plates: (r.plates || []).map(toFrame), lighting: r.lighting || 'good',
  };
}

// Search's verify step: look at the evidence frame again with the question.
export async function verify(e, question) {
  const v = get(e.cameraId);
  const r = await chat([readFileSync(frameFile(v.id, e.n)).toString('base64')],
    `Question about this CCTV frame: "${question}". The candidate is the ${e.entity} described as "${e.label}". Does the frame show what the question asks about? Answer yes, no or unsure, with a reason of at most 12 words.`,
    { type: 'object', required: ['answer', 'reason'], properties: { answer: { enum: ['yes', 'no', 'unsure'] }, reason: { type: 'string' } } });
  return { answer: r.answer, reason: r.reason, model: opts.model };
}

// ---------- tracks -> events ----------
const iou = (a, b) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const i = x * y; return i / (a[2] * a[3] + b[2] * b[3] - i || 1);
};
const mode = list => Object.entries(list.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1])[0]?.[0];
const STOP = new Set(['the', 'and', 'with', 'wearing', 'carrying', 'holding', 'near', 'from', 'into', 'side', 'front', 'back', 'some', 'small']);
const words = o => o.label.toLowerCase().split(/[^a-z]+/).filter(w => w.length > 2 && !STOP.has(w));

const centreGap = (a, b) => Math.hypot(a[0] + a[2] / 2 - b[0] - b[2] / 2, a[1] + a[3] / 2 - b[1] - b[3] / 2) / Math.max(a[2], a[3], b[2], b[3]);
const agree = (a, b) => { const A = new Set(words(a)), B = words(b); return B.filter(w => A.has(w)).length / (new Set([...A, ...B]).size || 1); };

// Greedy frame-to-frame linking. At a frame every couple of seconds a walking person's boxes barely overlap, so a
// detection joins a track when it is the same type, overlaps or sits within ~1.5 body-lengths of the track's last box,
// and the two descriptions agree (shared label words). Pure; tested in check.mjs.
export function track(frames, gapMax) {
  const tracks = [];
  for (const f of frames) {
    const taken = new Set();
    for (const o of f.objects) {
      const best = tracks.filter(tr => !taken.has(tr) && tr.type === o.type && f.t - tr.dets.at(-1).t <= gapMax && tr.dets.at(-1).n !== f.n)
        .map(tr => { const l = tr.dets.at(-1); return [tr, iou(l.box, o.box), centreGap(l.box, o.box), agree(l, o)]; })
        .filter(([, i, g, a]) => (i >= 0.1 || g < 1.5) && a >= 0.3).map(([tr, i, g, a]) => [tr, i + a - g / 3]).sort((a, b) => b[1] - a[1])[0];
      const d = { ...o, n: f.n, t: f.t, lighting: f.lighting };
      if (best) { best[0].dets.push(d); taken.add(best[0]); } else { const tr = { type: o.type, dets: [d] }; tracks.push(tr); taken.add(tr); }
    }
  }
  return tracks;
}

// A track's searchable words: its most common label, plus words most of its detections agree on (not the union,
// which lets one mislabelled frame make a "woman in red" track match "man in jeans").
function trackWords(ds) {
  const n = {};
  for (const d of ds) for (const w of new Set(words(d))) n[w] = (n[w] || 0) + 1;
  return [...new Set([...words({ label: mode(ds.map(d => d.label)) }), ...Object.keys(n).filter(w => n[w] >= ds.length / 2)])];
}

const ENTITY = { person: 'person', vehicle: 'vehicle', animal: 'animal', bag: 'object', other: 'object' };

// Camera clock: seconds since local midnight of `day` (the dataset's first day) in the camera's timezone.
function clockOf(iso, tz, day) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, sec: (Date.parse(date) - Date.parse(day ?? date)) / 1000 + +p.hour * 3600 + +p.minute * 60 + +p.second };
}
const hms = s => [s / 3600, (s % 3600) / 60, s % 60].map(n => String(Math.floor(n)).padStart(2, '0')).join(':');

// Builds the "My footage" dataset in the same shape as data.js.
export function dataset() {
  const ready = listVideos().filter(v => v.status === 'ready').sort((a, b) => a.start.localeCompare(b.start));
  if (!ready.length) return { source: 'mine', DEMO: false, DAY: new Date().toISOString().slice(0, 10), TZ: '', WINDOW: ['00:00:00', '00:00:01'], cameras: [], events: [], tracks: {} };
  const day = clockOf(ready[0].start, ready[0].tz).date;
  const cameras = [], events = [], tracks = {};
  ready.forEach((v, i) => {
    const t0 = clockOf(v.start, v.tz, day).sec, frames = existsSync(detFile(v.id)) ? JSON.parse(readFileSync(detFile(v.id), 'utf8')) : [];
    cameras.push({ id: v.id, code: `CAM ${String(i + 1).padStart(2, '0')}`, name: v.name, location: v.location, tz: v.tz, status: 'ready', real: true,
      coverage: [[hms(t0), hms(t0 + v.duration)]], sync: 0, neighbors: v.neighbors || [], width: v.width, height: v.height, t0,
      frames: frames.map(f => ({ n: f.n, t: f.t, faces: f.faces, plates: f.plates })) });
    track(frames, Math.max(3, 2.5 / (v.sampling || 0.5))).forEach((tr, k) => {
      const ds = tr.dets, rep = ds.reduce((a, b) => b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a);
      const c = d => [+(d.box[0] + d.box[2] / 2).toFixed(1), +(d.box[1] + d.box[3] / 2).toFixed(1)];   // box centre
      const id = `${v.id}_${k}`, trackId = `${v.id}:${k}`;
      tracks[trackId] = mode(ds.map(d => d.label)) || tr.type;
      events.push({ id, cameraId: v.id, track: trackId, entity: ENTITY[tr.type] || 'object', n: rep.n, t: rep.t, time: hms(t0 + rep.t),
        attrs: trackWords(ds), action: mode(ds.map(d => d.action).filter(Boolean)) || 'present', label: cap(tracks[trackId]),
        path: [c(ds[0]), c(ds.at(-1))], dets: ds.map(d => ({ t: d.t, box: d.box })), seen: ds.length,
        conf: { semantic: 0.75, visual: Math.min(1, 0.5 + 0.5 * (ds.length - 1) / 3) },
        quality: { occlusion: 'unknown', blur: 'unknown', lighting: mode(ds.map(d => d.lighting)) === 'good' ? 'good' : 'low', angle: 'unknown' } });
    });
  });
  linkAcrossCameras(events, cameras);
  const all = cameras.flatMap(c => c.coverage[0].map(s => +s.split(':').reduce((h, x) => h * 60 + +x, 0)));
  return { source: 'mine', DEMO: false, DAY: day, TZ: tzLabel(ready[0].tz), WINDOW: [hms(Math.min(...all)), hms(Math.max(...all))], cameras, events, tracks };
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
const tzLabel = tz => new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || tz;

// Possible re-identification across cameras: same entity type, shared colour/attribute words, later in time.
// Links are only ever "possible"; the journey view says so.
function linkAcrossCameras(events, cameras) {
  const tsec = e => cameras.find(c => c.id === e.cameraId).t0 + e.t;
  const sorted = [...events].sort((a, b) => tsec(a) - tsec(b));
  for (const e of sorted) {
    const prev = sorted.filter(p => p.cameraId !== e.cameraId && p.entity === e.entity && tsec(p) < tsec(e) && tsec(e) - tsec(p) < 900)
      .map(p => { const shared = p.attrs.filter(a => e.attrs.includes(a)); return [p, shared, shared.length / new Set([...p.attrs, ...e.attrs]).size]; })
      .filter(([, sh, j]) => sh.length >= 2 && j >= 0.4).sort((a, b) => b[2] - a[2])[0];
    if (prev && !sorted.some(o => o !== e && o.track === prev[0].track && o.cameraId === e.cameraId)) {
      const old = e.track; e.track = prev[0].track; e.match = { shared: prev[1], jaccard: +prev[2].toFixed(2), from: old };
    }
  }
}
