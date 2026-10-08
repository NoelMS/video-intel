// Indexes your recordings: ffmpeg samples frames (dropping near-duplicates), a local Ollama vision model describes
// each frame, detections are linked into tracks, tracks become events in the same shape as the demo data, and
// tracks on different cameras that look alike are linked as possible journeys. All local.
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync, statSync, renameSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import * as setup from './setup.mjs';
import * as detector from './detector.mjs';
import * as embed from './embed.mjs';

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
const embFile = (id, ext) => join(dirs().frames, id, 'embeddings.' + ext);   // .bin: Float32 vectors, .json: what each row is

// ---------- ingest ----------
const run = (exe, args, onErrLine) => new Promise((res, rej) => {
  const p = spawn(exe, args, { windowsHide: true });
  let out = '', err = '';
  p.stdout.on('data', d => out += d);
  p.stderr.on('data', d => { err += d; if (onErrLine) for (const l of String(d).split(/[\r\n]+/)) onErrLine(l); });
  p.on('error', rej).on('exit', code => code ? rej(new Error(err.split('\n').filter(Boolean).slice(-2).join(' ') || `exit ${code}`)) : res(out));
});

export async function probe(file) {
  const out = JSON.parse(await run(setup.ffprobePath(), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration:format_tags=creation_time', '-of', 'json', file]));
  const s = out.streams?.[0], created = Date.parse(out.format?.tags?.creation_time || '');
  if (!s || !(+out.format?.duration > 0)) throw new Error('No playable video stream found');
  // created: when the file says it was recorded (cameras and phones write it; 1970/2000 placeholders are ignored)
  return { duration: +out.format.duration, width: s.width, height: s.height, codec: s.codec_name, ...(created > Date.parse('2001-01-01') ? { created: new Date(created).toISOString() } : {}) };
}

// Stream an upload to disk, probe it, queue it. meta is validated by the server.
export const addVideo = (req, meta) => ingest(meta, file => pipeline(req, createWriteStream(file)));
// A file the server fetched itself (live capture, archive import): moved into the store, then queued.
export const addVideoFile = (src, meta) => ingest(meta, file => { try { renameSync(src, file); } catch { copyFileSync(src, file); rmSync(src, { force: true }); } });

async function ingest(meta, write) {
  if (!setup.ffmpegPath()) throw Object.assign(new Error('ffmpeg is not installed. Open System → Local analysis.'), { status: 409 });
  const id = 'v_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  mkdirSync(dirs().videos, { recursive: true });
  const v = { id, ...meta, file: id + meta.ext, status: 'queued', progress: { done: 0, total: 0 }, error: null, added: new Date().toISOString() };
  delete v.ext;
  await write(videoFile(v));
  try {
    Object.assign(v, await probe(videoFile(v)), { size: statSync(videoFile(v)).size });
    if (v.startFrom === 'file' && v.created) v.start = v.created;   // "use each file's own recording time"
  }
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
let current = null, opts = { model: 'qwen3-vl:2b-instruct', sampling: 0.5, describe: null };   // describe: test hook
export const configure = o => { opts = { ...opts, ...o }; };
export const busy = () => !!current;
// Clips waiting or being indexed (feeds stop capturing while this is high) and the measured model speed.
export const WORKING = ['queued', 'transcoding', 'extracting', 'analyzing', 'naming', 'embedding'];
// Frames per second sampled. The detector is cheap enough per frame for 5 fps: objects move less between frames, so
// tracking is more accurate (association F1 0.90 vs 0.82 at 2 fps), and playback boxes are at most 0.2 s old. The
// vision model alone is not, so it keeps the configured rate.
const rate = () => !opts.describe && setup.detectorOk() ? Math.max(5, opts.sampling) : opts.sampling;
export function backlog() {
  const all = listVideos(), wait = all.filter(v => WORKING.includes(v.status)), speed = all.filter(v => v.secPerFrame).slice(-10);
  const secPerFrame = speed.length ? speed.reduce((n, v) => n + v.secPerFrame, 0) / speed.length : null;
  const seconds = wait.reduce((n, v) => n + (v.duration || 0), 0);
  return { clips: wait.length, seconds, secPerFrame, eta: secPerFrame ? Math.round(seconds * rate() * secPerFrame) : null };
}

function kick() {
  if (current) return;
  const next = listVideos().find(v => WORKING.includes(v.status));
  if (!next) return void backfillEmbeddings().catch(() => {});
  current = { id: next.id, cancelled: false };
  index(next).then(() => { const v = get(next.id); if (v?.status === 'ready') opts.onReady?.(v); })
    .catch(e => { const v = get(current.id); if (v) put({ ...v, status: 'failed', error: e.message }); })
    .finally(() => { current = null; kick(); });
}
export const resume = kick;

// dur seconds of a recording centred on t, re-encoded so it starts exactly there (a stream copy starts at a keyframe).
export async function clip(v, t, dur) {
  const out = join(dirs().videos, `${v.id}.clip-${Date.now()}.mp4`), from = Math.max(0, Math.min(t - dur / 2, v.duration - dur));
  await run(setup.ffmpegPath(), ['-hide_banner', '-v', 'error', '-ss', from.toFixed(2), '-i', videoFile(v), '-t', String(dur), '-map', '0:v:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', '-y', out]);
  return out;
}

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
  // 1. frames: sample at rate() fps, scale to 768 px wide. Without the detector, near-identical frames are dropped
  // (mpdecimate): describing a static scene again costs seconds. With it they are kept: a frame costs ~0.1 s, and a
  // dropped stretch had no detections, so parked cars lost their boxes until something moved (a 9 s gap in a
  // Caltrans clip).
  const fast = !opts.describe && await detector.load(setup.DETECTOR_DIR);
  if (!existsSync(join(fdir, 'frames.json'))) {
    put({ ...v, status: 'extracting', progress: { done: 0, total: Math.round(v.duration) } });
    rmSync(fdir, { recursive: true, force: true }); mkdirSync(fdir, { recursive: true });
    const times = [];
    // The first real frame of each 1/rate slot, with its own timestamp. The fps filter labelled each slot with its start
    // but kept the slot's last frame, so every frame showed the scene ~half a slot later than its time (+0.24 s at
    // 2 fps, measured by matching pixels): boxes ran ahead of the objects in playback.
    const r = rate();
    await run(setup.ffmpegPath(), ['-hide_banner', '-nostats', '-i', videoFile(v), '-an',
      '-vf', `select='isnan(prev_selected_t)+gt(floor(t*${r}),floor(prev_selected_t*${r}))',${fast ? '' : 'mpdecimate,'}scale='min(768,iw)':-2,showinfo`, '-fps_mode', 'vfr', '-q:v', '4', join(fdir, '%06d.jpg')],
    line => {
      const m = line.match(/\bpts_time:\s*([\d.]+)/);
      if (m) { times.push(+m[1]); if (times.length % 10 === 0) put({ ...get(v.id), progress: { done: Math.round(+m[1]), total: Math.round(v.duration) } }); }
    });
    writeFileSync(join(fdir, 'frames.json'), JSON.stringify(times.map((t, i) => ({ n: i + 1, t: +t.toFixed(3) }))));
    put({ ...get(v.id), exactTimes: true });
  }
  const frames = JSON.parse(readFileSync(join(fdir, 'frames.json'), 'utf8'));
  if (!opts.describe && !await setup.ensureOllama()) throw new Error('Ollama is not running. Open System → Local analysis.');
  if (fast) return indexWithDetector(v, fdir, frames);
  // 2. describe each frame with the vision model (resumable: detections are saved as we go)
  const dets = existsSync(detFile(v.id)) ? JSON.parse(readFileSync(detFile(v.id), 'utf8')) : [];
  const doneN = new Set(dets.map(d => d.n));
  put({ ...get(v.id), status: 'analyzing', model: opts.model, sampling: opts.sampling, progress: { done: dets.length, total: frames.length } });
  let streak = 0, began = Date.now(), fresh = 0;
  for (const f of frames) {
    if (current.cancelled) return;
    if (doneN.has(f.n)) continue;
    const d = { ...f, ...await describeSafely(readFileSync(frameFile(v.id, f.n)).toString('base64')) }; fresh++;
    dets.push(d);
    streak = d.failed ? streak + 1 : 0;
    // A model that never answers in JSON (e.g. a reasoning model) fails fast instead of grinding through every frame.
    if (streak >= 5) { writeFileSync(detFile(v.id), JSON.stringify(dets)); throw new Error(`${streak} frames in a row could not be analysed: ${d.failed}`); }
    if (dets.length % 5 === 0 || dets.length === frames.length) {
      writeFileSync(detFile(v.id), JSON.stringify(dets));
      put({ ...get(v.id), progress: { done: dets.length, total: frames.length } });
    }
  }
  writeFileSync(detFile(v.id), JSON.stringify(dets));
  const skipped = dets.filter(d => d.failed);
  if (skipped.length > dets.length / 2) throw new Error(`${skipped.length} of ${dets.length} frames could not be analysed: ${skipped.at(-1).failed}`);
  put({ ...get(v.id), status: 'ready', indexedAt: new Date().toISOString(), progress: { done: frames.length, total: frames.length },
    skipped: skipped.length, found: dets.reduce((n, d) => n + d.objects.length, 0), ...(fresh ? { secPerFrame: +((Date.now() - began) / 1000 / fresh).toFixed(1) } : {}) });
}

// With the detector: YOLOX finds objects in every frame (~70 ms each), they are linked into tracks, and the vision
// model then names each track once from a crop of its largest sighting, instead of describing every frame.
// Actions come from movement along the track, lighting from frame brightness.
// ponytail: not resumable mid-way (a cancelled run starts this step over); it is minutes even for an hour of footage.
async function indexWithDetector(v, fdir, frames) {
  const began = Date.now(), [W, H] = (await run(setup.ffprobePath(), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', frameFile(v.id, 1)])).trim().split(',').map(Number);
  put({ ...get(v.id), status: 'analyzing', model: opts.model, detector: `YOLOX-S (${detector.status().provider})`, sampling: rate(), progress: { done: 0, total: frames.length } });
  const dets = [];
  for await (const px of detector.frames(setup.ffmpegPath(), join(fdir, '%06d.jpg'))) {
    if (current.cancelled) return;
    const f = frames[dets.length];
    if (!f) break;
    const objects = (await detector.detect(px, W, H)).map(o => ({ type: o.type, label: o.cls, cls: o.cls, score: o.score, box: o.box, action: '' }));
    dets.push({ ...f, objects, ...privacyBoxes(objects), lighting: detector.lighting(px, W, H) });
    if (dets.length % 10 === 0) put({ ...get(v.id), progress: { done: dets.length, total: frames.length } });
  }
  // detector class names flip (car/truck), so they are not compared; boxes are steady enough for tighter limits
  const tracks = track(dets, 2, { labels: false, gate: 0.75, size: true });
  tracks.forEach((tr, k) => { for (const d of tr.dets) d.src.tk = k; });
  for (const tr of tracks) { const action = movement(tr); for (const d of tr.dets) d.src.action = action; }
  // Named from each track's largest sighting. Tracks seen for under a second (mostly fragments and false alarms; at
  // 5 fps ~20% of naming calls) and objects under ~16 px (nothing to describe) keep the detector's class name.
  const toName = tracks.map(tr => ({ tr, rep: tr.dets.reduce((a, b) => b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a) }))
    .filter(({ tr, rep }) => tr.dets.at(-1).t - tr.dets[0].t >= 1 && rep.box[2] * W / 640 >= 16 && rep.box[3] * H / 360 >= 16);
  put({ ...get(v.id), status: 'naming', progress: { done: 0, total: toName.length } });
  for (let i = 0; i < toName.length; i += SIDE.length) {
    if (current.cancelled) return;
    const group = toName.slice(i, i + SIDE.length), labels = await nameObjects(v, group.map(g => g.rep), W, H);
    group.forEach(({ tr }, k) => { if (labels[k]) for (const d of tr.dets) d.src.label = labels[k]; });
    put({ ...get(v.id), progress: { done: Math.min(i + SIDE.length, toName.length), total: toName.length } });
  }
  writeFileSync(detFile(v.id), JSON.stringify(dets));
  if (await embed.load(setup.DETECTOR_DIR)) { put({ ...get(v.id), status: 'embedding' }); if (await embedVideo(v, fdir, dets, tracks, W, H) === false) return; }
  put({ ...get(v.id), status: 'ready', indexedAt: new Date().toISOString(), progress: { done: frames.length, total: frames.length }, skipped: 0,
    found: dets.reduce((n, d) => n + d.objects.length, 0), tracks: tracks.length, ...(frames.length ? { secPerFrame: +((Date.now() - began) / 1000 / frames.length).toFixed(2) } : {}) });
}

// Two objects named in one call: their crops (with some context) side by side in one picture. Ollama scales every
// picture up to ~1,100 tokens however small, and reading it is most of a call's time: one picture per object took
// ~2.2 s each. Measured against naming each crop alone, two per picture agreed on the main colour 18 times in 20
// (~1.1 s an object); a 2x2 grid only 14 in 20, drifting to "black" (~0.5 s an object).
// Fixed choices instead of free text keep the reply to a few tokens and the labels to the words people search with
// (free text rambled: "car from cctv frame, blurry, dark grey, no clear details"). An unusable reply keeps class names.
const TILE = 256, SIDE = ['left', 'right'];
async function nameObjects(v, reps, W, H) {
  const crop = d => {
    const [x, y, w, h] = [d.box[0] * W / 640, d.box[1] * H / 360, d.box[2] * W / 640, d.box[3] * H / 360];
    const cx = Math.max(0, Math.round(x - w * 0.15)), cy = Math.max(0, Math.round(y - h * 0.15));
    return `crop=${Math.min(W - cx, Math.round(w * 1.3))}:${Math.min(H - cy, Math.round(h * 1.3))}:${cx}:${cy}`;
  };
  const tiles = [...reps.map((d, i) => `[${i}:v]${crop(d)},scale=${TILE}:${TILE}:force_original_aspect_ratio=decrease,pad=${TILE}:${TILE}:-1:-1:white[t${i}]`),
    ...SIDE.slice(reps.length).map((_, k) => `color=white:s=${TILE}x${TILE}:d=1[b${k}]`)];
  const grid = `${reps.map((_, i) => `[t${i}]`).join('')}${SIDE.slice(reps.length).map((_, k) => `[b${k}]`).join('')}hstack=inputs=${SIDE.length}[out]`;
  const jpg = await new Promise((res, rej) => {
    const p = spawn(setup.ffmpegPath(), ['-v', 'error', ...reps.flatMap(d => ['-i', frameFile(v.id, d.n)]), '-filter_complex', [...tiles, grid].join(';'),
      '-map', '[out]', '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '3', 'pipe:1'], { windowsHide: true });
    const out = []; p.stdout.on('data', c => out.push(c)); p.on('error', rej).on('exit', c => c ? rej(new Error('Could not crop objects for naming')) : res(Buffer.concat(out)));
  });
  const kind = d => NAMING[d.cls] || NAMING.other;
  const prompt = `This picture is two separate photos side by side: ${reps.map((d, i) => `${SIDE[i]} a ${d.cls}`).join(', ')}${reps.length < SIDE.length ? ', the other blank' : ''}. For each photo, describe that one object: a vehicle's main colour and body type; a person's top colour, trouser or skirt colour, and what they carry; anything else its main colour.`;
  try {
    const r = await chat([jpg.toString('base64')], prompt, obj(Object.fromEntries(reps.map((d, i) => [SIDE[i], kind(d).schema]))));
    return reps.map((d, i) => r[SIDE[i]] ? kind(d).label(r[SIDE[i]], d.cls) : null);
  } catch (e) { if (e.badReply != null) return reps.map(() => null); throw e; }
}
const COLOUR = { enum: ['black', 'white', 'grey', 'silver', 'red', 'blue', 'green', 'yellow', 'orange', 'brown', 'beige', 'purple', 'pink'] };
const obj = props => ({ type: 'object', required: Object.keys(props), properties: props });
// The body-type list includes the neighbouring classes: the detector calls some vans buses and some SUVs trucks.
const vehicle = { schema: obj({ colour: COLOUR, body: { enum: ['car', 'hatchback', 'saloon', 'estate', 'SUV', 'taxi', 'van', 'pickup', 'truck', 'lorry', 'bus'] } }), label: r => `${r.colour} ${r.body}` };
const NAMING = {
  car: vehicle, truck: vehicle, bus: vehicle,
  person: { schema: obj({ top: COLOUR, bottom: COLOUR, carrying: { enum: ['nothing', 'bag', 'backpack', 'suitcase', 'umbrella', 'phone', 'child', 'other'] } }),
    label: r => `person in ${r.top} top and ${r.bottom} trousers${['nothing', 'other'].includes(r.carrying) ? '' : `, carrying ${r.carrying === 'child' ? 'a child' : `a ${r.carrying}`}`}` },
  other: { schema: obj({ colour: COLOUR }), label: (r, cls) => `${r.colour} ${cls}` },
};

// Moving when the box centre travels more than half its size over the track.
function movement(tr) {
  const [a, b] = [tr.dets[0].box, tr.dets.at(-1).box], size = (Math.max(a[2], a[3]) + Math.max(b[2], b[3])) / 2;
  const moving = Math.hypot(b[0] + b[2] / 2 - a[0] - a[2] / 2, b[1] + b[3] / 2 - a[1] - a[3] / 2) > size / 2;
  return { person: moving ? 'walking' : 'standing', vehicle: moving ? 'driving' : 'stopped' }[tr.type] || (moving ? 'moving' : 'still');
}

// Privacy masks without a face or plate detector: the head of every person and the plate area of every vehicle.
// ponytail: deliberately generous (masks a head-sized area whatever the pose); a face/plate model would be exact.
function privacyBoxes(objects) {
  const r = n => +n.toFixed(1);
  return {
    faces: objects.filter(o => o.type === 'person' && o.box[3] > 12).map(({ box: [x, y, w, h] }) => [r(x + w * 0.15), r(y), r(w * 0.7), r(Math.min(h * 0.22, w * 0.9))]),
    plates: objects.filter(o => ['car', 'truck', 'bus', 'motorcycle'].includes(o.cls) && o.box[2] > 20).map(({ box: [x, y, w, h] }) => [r(x + w * 0.3), r(y + h * 0.6), r(w * 0.4), r(h * 0.25)]),
  };
}

// Image embeddings (MobileCLIP, embed.mjs) for search: each track's largest sighting, cropped square with some context,
// and one whole frame per second (centre square, standard CLIP preprocessing; the baseline searches these). One more
// pass over the frame JPEGs through ffmpeg; ~20 ms an embedding on the GPU.
async function embedVideo(v, fdir, frames, tracks, W, H) {
  const r = Math.min(640 / W, 640 / H), want = new Map(), perSecond = new Set();
  tracks.forEach((tr, tk) => { const rep = tr.dets.reduce((a, b) => b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a); want.set(rep.n, [...(want.get(rep.n) || []), { tk, box: rep.box }]); });
  let second = -1;
  for (const f of frames) if (Math.floor(f.t) !== second) { second = Math.floor(f.t); perSecond.add(f.n); }
  const rows = [], vecs = [];
  let i = 0;
  for await (const px of detector.frames(setup.ffmpegPath(), join(fdir, '%06d.jpg'))) {
    if (current?.cancelled) return false;
    const f = frames[i++];
    if (!f) break;
    for (const o of want.get(f.n) || []) {
      const [x, y, w, h] = [o.box[0] / 640 * W * r, o.box[1] / 360 * H * r, o.box[2] / 640 * W * r, o.box[3] / 360 * H * r], side = Math.max(w, h) * 1.15;
      vecs.push(await embed.imageEmbed(embed.squareCrop(px, 640, 640, [x + w / 2 - side / 2, y + h / 2 - side / 2, side])));
      rows.push({ kind: 'track', tk: o.tk, n: f.n, t: f.t });
    }
    if (perSecond.has(f.n)) {
      const pw = W * r, ph = H * r, side = Math.min(pw, ph);
      vecs.push(await embed.imageEmbed(embed.squareCrop(px, 640, 640, [(pw - side) / 2, (ph - side) / 2, side])));
      rows.push({ kind: 'frame', n: f.n, t: f.t });
    }
  }
  writeFileSync(embFile(v.id, 'bin'), Buffer.concat(vecs.map(x => Buffer.from(x.buffer))));
  writeFileSync(embFile(v.id, 'json'), JSON.stringify({ model: 'mobileclip_s0', dim: vecs[0]?.length || 0, rows }));
  embCache.delete(v.id);
}
// A video's embeddings, as { rows, vec(i) } (cached; read by search and the baseline). null when it has none.
const embCache = new Map();
export function embeddings(id) {
  if (embCache.has(id)) return embCache.get(id);
  if (!existsSync(embFile(id, 'json'))) return null;
  const meta = JSON.parse(readFileSync(embFile(id, 'json'), 'utf8')), b = readFileSync(embFile(id, 'bin'));
  const all = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4), e = { ...meta, vec: i => all.subarray(i * meta.dim, (i + 1) * meta.dim) };
  embCache.set(id, e);
  return e;
}
// Recordings indexed with the detector before embeddings existed get them while the queue is idle (no re-indexing).
let backfilling = false;
async function backfillEmbeddings() {
  if (backfilling || current || !await embed.load(setup.DETECTOR_DIR)) return;
  backfilling = true;
  try {
    for (const v of listVideos().filter(v => v.status === 'ready' && v.detector && !existsSync(embFile(v.id, 'json')))) {
      if (current) break;
      const fdir = join(dirs().frames, v.id), frames = existsSync(detFile(v.id)) ? JSON.parse(readFileSync(detFile(v.id), 'utf8')) : [];
      const tracks = storedTracks(frames);
      if (!tracks?.length) continue;
      const [W, H] = (await run(setup.ffprobePath(), ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', frameFile(v.id, 1)])).trim().split(',').map(Number);
      await embedVideo(v, fdir, frames, tracks, W, H);
    }
  } finally { backfilling = false; }
}

// One unusable reply (empty, cut off, or reasoning instead of JSON) is retried once, then that frame is skipped rather
// than failing the whole recording. Errors that retrying cannot fix (Ollama down, model missing) still stop indexing.
async function describeSafely(b64) {
  for (let attempt = 0; ; attempt++) {
    try { return await (opts.describe ?? describeFrame)(b64); } catch (e) {
      if (!e.badReply) throw e;
      if (attempt) return { objects: [], faces: [], plates: [], lighting: 'good', failed: e.message };
    }
  }
}

// ---------- the vision model ----------
const BOX = { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 };
// Lean on purpose: on a 4 GB GPU every output token costs time. Labels carry colours, clothing and carried items, so
// separate colour/attribute lists only added tokens (measured 5.4 s vs ~45 s a frame with them on qwen3-vl:2b).
// maxItems caps the grammar, so a small model that starts repeating itself still closes valid JSON.
// Faces, plates and lighting come first, so cutting the object list short (describeFrame) never drops a privacy box.
// That order also made the 2B model list the vehicles it used to miss.
export const SCHEMA = {
  type: 'object', required: ['faces', 'plates', 'lighting', 'objects'],
  properties: {
    faces: { type: 'array', maxItems: 8, items: BOX }, plates: { type: 'array', maxItems: 8, items: BOX },
    lighting: { enum: ['good', 'low', 'night'] },
    objects: { type: 'array', maxItems: 12, items: { type: 'object', required: ['type', 'label', 'box', 'action'], properties: {
      type: { enum: ['person', 'vehicle', 'animal', 'bag', 'other'] }, label: { type: 'string' }, box: BOX, action: { type: 'string' } } } },
  },
};
// No example labels: the 2B model copied them verbatim onto unrelated people.
export const PROMPT = `Index this CCTV frame. First the boxes of clearly visible faces and licence plates, and the lighting. Then list each distinct person, vehicle, animal and carried bag exactly once: type; a short label with its actual colours and clothing, carried items or vehicle body type; box [x1, y1, x2, y2] in 0-1000 image coordinates; action. Only what you can see; never repeat an object.`;

// Whole model on the GPU. Ollama's own estimate kept 20% of qwen3-vl:2b on the CPU of a 4 GB card although it fits
// (77 -> 101 tokens/s). If it does not fit, the first out-of-memory error hands the split back to Ollama for this run.
let fullGpu = true;
async function chat(images, prompt, format, cut) {
  try { return await ask(images, prompt, format, cut); } catch (e) {
    if (!fullGpu || !e.ollama || !/memory|alloc/i.test(e.message)) throw e;
    fullGpu = false; return ask(images, prompt, format, cut);
  }
}
// Streamed, so `cut` can end a reply early: given the text so far, it returns the result to use instead, or nothing.
async function ask(images, prompt, format, cut) {
  const ollamaErr = m => Object.assign(new Error(`Ollama: ${String(m).slice(0, 200)}`), { ollama: true });
  const res = await fetch(setup.OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify({
    // num_ctx: one frame plus the prompt is ~1-2K tokens; the model's 256K default would not fit in memory.
    // Use the -instruct tags: plain qwen3-vl:2b is the thinking variant, and on Ollama 0.40 it ignores think: false and
    // /no_think once a schema is set, reasoning until num_ctx runs out (2,940 tokens, 110 s, no JSON).
    model: opts.model, stream: true, format, think: false, keep_alive: '10m', options: { temperature: 0, num_ctx: 4096, ...(fullGpu && { num_gpu: 99 }) },
    messages: [{ role: 'user', content: prompt, images }] }) });
  if (!res.ok) throw ollamaErr(`${res.status} ${await res.text()}`);
  const m = { content: '', thinking: '' }, dec = new TextDecoder();
  let buf = '';
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    for (let i; (i = buf.indexOf('\n')) >= 0; buf = buf.slice(i + 1)) {
      const r = JSON.parse(buf.slice(0, i));
      if (r.error) throw ollamaErr(r.error);
      m.content += r.message?.content || ''; m.thinking += r.message?.thinking || '';
    }
    const early = cut?.(m.content);
    if (early) return early;   // leaving the loop closes the stream, and Ollama stops generating
  }
  // Older Ollama put a thinking model's JSON in `thinking` with `content` empty, so look in both.
  for (const text of [m.content, m.thinking]) { const j = jsonIn(text); if (j) return j; }
  // A reply that is all reasoning comes from the model itself (it ignores think: false), so it is never retried.
  throw Object.assign(new Error(m.thinking
    ? `${opts.model} spent its whole reply reasoning. Pick an -instruct model (e.g. qwen3-vl:2b-instruct) in System → Local analysis.`
    : 'The vision model did not return JSON. Try again, or pick another model in System → Local analysis.'), { badReply: !m.thinking });
}
export function jsonIn(text) {
  const t = String(text ?? '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').trim(), i = t.indexOf('{');
  if (i < 0) return null;
  try { return JSON.parse(t.slice(i, t.lastIndexOf('}') + 1)); } catch { return null; }
}

// 0-1000 corner boxes -> [x, y, w, h] in the app's 640x360 frame space
const toFrame = b => {
  const [x1, y1, x2, y2] = b.map(n => Math.min(1000, Math.max(0, +n || 0)));
  const [a, c] = [Math.min(x1, x2), Math.max(x1, x2)], [bb, d] = [Math.min(y1, y2), Math.max(y1, y2)];
  return [a * 0.64, bb * 0.36, (c - a) * 0.64, (d - bb) * 0.36].map(n => +n.toFixed(1));
};

// Small models sometimes list one object twice (same type, heavily overlapping boxes), or fall into a loop that repeats
// one label with an identical-size box stepped sideways; both are dropped.
const sameSize = (a, b) => Math.abs(a[2] - b[2]) < 1 && Math.abs(a[3] - b[3]) < 1;
const dedupe = os => os.filter((o, i) => !os.slice(0, i).some(p => p.type === o.type && (iou(p.box, o.box) > 0.7 || (p.label === o.label && sameSize(p.box, o.box)))));

// The objects complete so far in a streamed reply, and whether the last one starts the 2B model's loop: the same label
// again on the same rows (one object stepped sideways across the frame until maxItems). On busy frames it looped every
// time, so ~70% of each reply was output dedupe() then threw away; cutting there took 12.5 s a frame down to ~3.7 s.
// ponytail: two distinct same-label objects on exactly the same rows end the list early; compare crops if that bites.
const OBJ = /\{[^{}[\]]*"box"\s*:\s*\[[^\]]*\][^{}[\]]*\}/g;
export function streamedObjects(text) {
  const at = text.indexOf('"objects"');
  if (at < 0) return { objects: [], loop: false };
  const os = [...text.slice(at).matchAll(OBJ)].map(m => { try { return JSON.parse(m[0]); } catch { return null; } }).filter(o => Array.isArray(o?.box)), last = os.at(-1);
  const loop = !!last && os.slice(0, -1).some(o => o.label === last.label && Math.abs(o.box[1] - last.box[1]) < 3 && Math.abs(o.box[3] - last.box[3]) < 3);
  return { objects: loop ? os.slice(0, -1) : os, loop, head: text.slice(0, at) };
}
const cutLoop = text => {
  const s = streamedObjects(text);
  return s.loop && { ...jsonIn(s.head.replace(/,\s*$/, '') + '}'), objects: s.objects };
};

export async function describeFrame(b64) {
  const r = await chat([b64], PROMPT, SCHEMA, cutLoop);
  return {
    objects: dedupe((r.objects || []).map(o => ({ ...o, box: toFrame(o.box) })).filter(o => o.box[2] > 2 && o.box[3] > 2)),
    faces: (r.faces || []).map(toFrame), plates: (r.plates || []).map(toFrame), lighting: r.lighting || 'good',
  };
}

// Search's verify step: look at the evidence frame again with the question.
export async function verify(e, question) {
  const r = await chat([readFileSync(frameFile(e.vid, e.n)).toString('base64')],
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

// Frame-to-frame linking, SORT-style: each track's box is moved forward along its recent motion to the new frame's
// time, every (track, detection) pair that could be the same object is scored, and the best pairs are taken first
// across the whole frame (not detection by detection, which let an early detection steal a later one's track).
// A pair must be the same type, overlap the predicted box or sit within `gate` box-sizes of it, and with `labels`
// share description words; with `size` the two boxes must be within 4x in area.
// Measured on five TfL clips against 25 fps reference identities (association F1): the old one-at-a-time linker
// scored 0.70 at 2 fps and 0.82 at 5 fps; this, with the detector's settings, 0.82 and 0.90. Pure; tested in check.mjs.
export function track(frames, gapMax, { labels = true, gate = 1.5, size = false } = {}) {
  const tracks = [];
  const predicted = (tr, t) => {
    const ds = tr.dets, l = ds.at(-1), p = ds[Math.max(0, ds.length - 3)], dt = l.t - p.t;
    if (dt <= 0) return l.box;
    const k = Math.min(t - l.t, 1) / dt;   // at most a second ahead
    return [l.box[0] + (l.box[0] - p.box[0]) * k, l.box[1] + (l.box[1] - p.box[1]) * k, l.box[2], l.box[3]];
  };
  const area = b => Math.max(b[2] * b[3], 1);
  for (const f of frames) {
    const pairs = [];
    for (const tr of tracks) {
      const l = tr.dets.at(-1);
      if (f.t - l.t > gapMax || l.n === f.n) continue;
      const p = predicted(tr, f.t);
      f.objects.forEach((o, k) => {
        if (o.type !== tr.type) return;
        const i = iou(p, o.box), g = centreGap(p, o.box), a = labels ? agree(l, o) : 1, s = Math.min(area(o.box), area(l.box)) / Math.max(area(o.box), area(l.box));
        if ((i >= 0.1 || g < gate) && a >= 0.3 && (!size || s >= 0.25)) pairs.push([i - g / 3 + (labels ? a : 0) + (size ? s / 2 : 0), tr, k]);
      });
    }
    pairs.sort((x, y) => y[0] - x[0]);
    const used = new Set(), match = new Map();
    for (const [, tr, k] of pairs) if (!used.has(tr) && !match.has(k)) { used.add(tr); match.set(k, tr); }
    f.objects.forEach((o, k) => {
      const d = { ...o, n: f.n, t: f.t, lighting: f.lighting, src: o }, tr = match.get(k);   // src: the frame's own object
      if (tr) tr.dets.push(d); else tracks.push({ type: o.type, dets: [d] });
    });
  }
  return tracks;
}
// Tracks saved at indexing time (each object's tk), so search sees exactly what the indexer tracked and named.
function storedTracks(frames) {
  const m = new Map();
  for (const f of frames) for (const o of f.objects) {
    if (o.tk == null) return null;
    if (!m.has(o.tk)) m.set(o.tk, { tk: o.tk, type: o.type, dets: [] });
    m.get(o.tk).dets.push({ ...o, n: f.n, t: f.t, lighting: f.lighting });
  }
  return [...m.values()];
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

// Builds the "My footage" dataset in the same shape as data.js. Clips that share a cameraKey (a live feed's captures,
// an archive camera's files) form one camera: its coverage is the clips, and frames/events carry the clip id (v/vid)
// and clip-relative time (vt) for images, playback and verification. Times (t) are seconds from the camera's first clip.
// One day at a time: footage from different days (an archive from 2018, live captures from today) cannot share the
// seconds-since-midnight time axis, so the dataset is the chosen day's footage (default: the latest) and lists the rest.
const camKey = v => v.cameraKey || v.id;
// One clock for every camera: this computer's timezone. Each camera on its own local clock put a London capture at
// 17:00 and a California capture made at the same moment at 09:00 on one axis, so the window spanned both and every
// camera reported the other's hours as unsearched gaps. (Recording lists and playback still show each camera's zone.)
const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;
export function dataset(pick = null) {
  const all = listVideos().filter(v => v.status === 'ready').sort((a, b) => a.start.localeCompare(b.start));
  const dateOf = v => clockOf(v.start, ZONE).date, days = [...new Set(all.map(dateOf))].sort().reverse();
  const day = days.includes(pick) ? pick : days[0], ready = all.filter(v => dateOf(v) === day);
  if (!ready.length) return { source: 'mine', DEMO: false, DAY: new Date().toISOString().slice(0, 10), TZ: '', WINDOW: ['00:00:00', '00:00:01'], cameras: [], events: [], tracks: {}, days };
  const groups = new Map();
  for (const v of ready) groups.set(camKey(v), [...(groups.get(camKey(v)) || []), v]);
  const cameras = [], events = [], tracks = {};
  [...groups].forEach(([key, vs], i) => {
    const t0 = clockOf(vs[0].start, ZONE, day).sec;
    const cam = { id: key, code: `CAM ${String(i + 1).padStart(2, '0')}`, name: vs[0].name, location: vs[0].location, tz: vs[0].tz, status: 'ready', real: true,
      coverage: [], sync: 0, neighbors: [...new Set(vs.flatMap(v => v.neighbors || []))], width: vs[0].width, height: vs[0].height, t0, frames: [],
      clips: vs.length, source: vs[0].source || null };
    for (const v of vs) {
      const em = embeddings(v.id);
      if (em) cam.embedded = { objects: (cam.embedded?.objects || 0) + em.rows.filter(r => r.kind === 'track').length, frames: (cam.embedded?.frames || 0) + em.rows.filter(r => r.kind === 'frame').length };
      // Recordings indexed before exactTimes show each frame's scene half a sampling interval after its stored time.
      const late = v.exactTimes ? 0 : 0.5 / (v.sampling || 0.5), off = clockOf(v.start, ZONE, day).sec - t0;
      const frames = (existsSync(detFile(v.id)) ? JSON.parse(readFileSync(detFile(v.id), 'utf8')) : []).map(f => ({ ...f, t: f.t + late }));
      cam.coverage.push([t0 + off, t0 + off + v.duration]);
      cam.frames.push(...frames.map(f => ({ n: f.n, v: v.id, t: +(off + f.t).toFixed(2), faces: f.faces, plates: f.plates })));
      (storedTracks(frames) ?? track(frames, Math.max(3, 2.5 / (v.sampling || 0.5)))).forEach((tr, i) => {
        const k = tr.tk ?? i;
        const ds = tr.dets, rep = ds.reduce((a, b) => b.box[2] * b.box[3] > a.box[2] * a.box[3] ? b : a);
        const c = d => [+(d.box[0] + d.box[2] / 2).toFixed(1), +(d.box[1] + d.box[3] / 2).toFixed(1)];   // box centre
        const id = `${v.id}_${k}`, trackId = `${v.id}:${k}`;
        tracks[trackId] = mode(ds.map(d => d.label)) || tr.type;
        events.push({ id, cameraId: key, vid: v.id, vt: rep.t, track: trackId, entity: ENTITY[tr.type] || 'object', n: rep.n, t: +(off + rep.t).toFixed(2), time: hms(t0 + off + rep.t),
          attrs: trackWords(ds), action: mode(ds.map(d => d.action).filter(Boolean)) || 'present', label: cap(tracks[trackId]),
          path: [c(ds[0]), c(ds.at(-1))], dets: ds.map(d => ({ t: +(off + d.t).toFixed(2), box: d.box })), seen: ds.length,
          conf: { semantic: 0.75, visual: Math.min(1, 0.5 + 0.5 * (ds.length - 1) / 3) },
          quality: { occlusion: 'unknown', blur: 'unknown', lighting: mode(ds.map(d => d.lighting)) === 'good' ? 'good' : 'low', angle: 'unknown' } });
      });
    }
    // overlapping clips merge into one covered span; the gaps between captures stay visible as coverage gaps
    const merged = [];
    for (const [a, b] of cam.coverage.sort((x, y) => x[0] - y[0])) merged.length && a <= merged.at(-1)[1] + 1 ? merged.at(-1)[1] = Math.max(merged.at(-1)[1], b) : merged.push([a, b]);
    cam.coverage = merged.map(([a, b]) => [hms(a), hms(b)]);
    cam.frames.sort((a, b) => a.t - b.t);
    cameras.push(cam);
  });
  linkAcrossCameras(events, cameras);
  const span = cameras.flatMap(c => c.coverage.flat().map(s => +s.split(':').reduce((h, x) => h * 60 + +x, 0)));
  return { source: 'mine', DEMO: false, DAY: day, days, TZ: tzLabel(ZONE, ready[0].start), WINDOW: [hms(Math.min(...span)), hms(Math.max(...span))], cameras, events, tracks };
}
const cap = s => s ? s[0].toUpperCase() + s.slice(1) : s;
// The zone's name on the footage's own date (EST vs EDT), not today's.
const tzLabel = (tz, at) => new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'short' }).formatToParts(new Date(at)).find(p => p.type === 'timeZoneName')?.value || tz;

// Possible re-identification across cameras: same entity type, shared colour/attribute words, later in time.
// Links are only ever "possible"; the journey view says so.
// With image embeddings, a link also needs the two crops to look alike (cosine >= REID_MIN) and the label's colours not
// to contradict: shared label words alone linked every "white van" on one camera to every "white van" on the next.
// The most similar earlier sighting wins. Without embeddings (vision-model-only indexing), shared words decide as before.
export const REID_MIN = 0.8;
const COLOURS = new Set(['black', 'white', 'grey', 'silver', 'red', 'blue', 'green', 'yellow', 'orange', 'brown', 'beige', 'purple', 'pink']);
function crop(e) {
  const em = e.vid && embeddings(e.vid), tk = +e.id.slice(e.id.lastIndexOf('_') + 1);
  const i = em ? em.rows.findIndex(r => r.kind === 'track' && r.tk === tk) : -1;
  return i >= 0 ? em.vec(i) : null;
}
function linkAcrossCameras(events, cameras) {
  const tsec = e => cameras.find(c => c.id === e.cameraId).t0 + e.t;
  const sorted = [...events].sort((a, b) => tsec(a) - tsec(b)), vec = new Map(sorted.map(e => [e, crop(e)]));
  const colours = e => e.attrs.filter(a => COLOURS.has(a));
  for (const e of sorted) {
    const prev = sorted.filter(p => p.cameraId !== e.cameraId && p.entity === e.entity && tsec(p) < tsec(e) && tsec(e) - tsec(p) < 900)
      .map(p => {
        const shared = p.attrs.filter(a => e.attrs.includes(a)), jaccard = shared.length / new Set([...p.attrs, ...e.attrs]).size;
        const [a, b] = [vec.get(p), vec.get(e)];
        if (!a || !b) return [p, shared, jaccard, null, shared.length >= 2 && jaccard >= 0.4];
        const cos = embed.cosine(a, b), clash = colours(p).length && colours(e).length && !colours(p).some(c => colours(e).includes(c));
        return [p, shared, jaccard, cos, cos >= REID_MIN && !clash];
      })
      .filter(x => x[4]).sort((x, y) => (y[3] ?? y[2]) - (x[3] ?? x[2]))[0];
    if (prev && !sorted.some(o => o !== e && o.track === prev[0].track && o.cameraId === e.cameraId)) {
      const old = e.track; e.track = prev[0].track; e.match = { shared: prev[1], jaccard: +prev[2].toFixed(2), ...(prev[3] != null ? { appearance: +prev[3].toFixed(3) } : {}), from: old };
    }
  }
}
