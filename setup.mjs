// Local-analysis dependencies: ffmpeg (decodes any CCTV codec), Ollama (runs the vision model), and the model.
// Everything installs per-user into known places, downloads are verified against published SHA-256 sums,
// and nothing needs admin rights.
import { createWriteStream, createReadStream, existsSync, mkdirSync, rmSync, readdirSync, copyFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = dirname(fileURLToPath(import.meta.url));
const RT = join(root, '.runtime');
export const OLLAMA = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
export const MODELS = {
  'qwen3-vl:2b-instruct': { size: '1.9 GB', note: 'Fits a 4 GB GPU. Fastest.' },
  'qwen3-vl:4b-instruct': { size: '3.3 GB', note: 'More accurate. Needs about 6 GB of GPU memory, otherwise partly runs on the CPU.' },
};
const FFMPEG_ZIP = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
const OLLAMA_SETUP = 'https://github.com/ollama/ollama/releases/latest/download/OllamaSetup.exe';
const OLLAMA_SUMS = 'https://github.com/ollama/ollama/releases/latest/download/sha256sum.txt';

const which = name => spawnSync('where', [name], { encoding: 'utf8', windowsHide: true }).stdout?.split(/\r?\n/).find(Boolean) || null;
const firstExisting = list => list.find(p => p && existsSync(p)) || null;

export const ffmpegPath = () => firstExisting([join(RT, 'ffmpeg', 'ffmpeg.exe'), which('ffmpeg')]);
export const ffprobePath = () => firstExisting([join(RT, 'ffmpeg', 'ffprobe.exe'), which('ffprobe')]);
const ollamaExe = () => firstExisting([join(process.env.LOCALAPPDATA || '', 'Programs', 'Ollama', 'ollama.exe'), which('ollama')]);

async function ollamaVersion() {
  try { return (await (await fetch(OLLAMA + '/api/version', { signal: AbortSignal.timeout(1500) })).json()).version; } catch { return null; }
}
export async function hasModel(name) {
  try {
    const { models } = await (await fetch(OLLAMA + '/api/tags', { signal: AbortSignal.timeout(3000) })).json();
    return models.some(m => m.name === name || m.name === name + ':latest');
  } catch { return false; }
}

// Start Ollama's server if it is installed but not running (hidden, detached so it outlives us).
export async function ensureOllama() {
  if (await ollamaVersion()) return true;
  const exe = ollamaExe();
  if (!exe) return false;
  spawn(exe, ['serve'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); if (await ollamaVersion()) return true; }
  return false;
}

export async function status(model) {
  const version = await ollamaVersion();
  return {
    ffmpeg: { ok: !!(ffmpegPath() && ffprobePath()), path: ffmpegPath() },
    ollama: { installed: !!(version || ollamaExe()), running: !!version, version },
    model: { name: model, ok: version ? await hasModel(model) : false },
    models: MODELS,
    job,
  };
}

// ---------- install job (one at a time; the UI polls status().job) ----------
let job = null;
export const busy = () => job && !job.finished;

// Resumes with a Range request when the connection drops (large files on slow links), then hashes the whole file.
export async function download(url, file, step) {
  step.done = 0; step.total = 0;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, step.done ? { headers: { range: `bytes=${step.done}-` } } : {}).catch(e => e);
    const resumed = res.status === 206;
    if (res instanceof Error || !(res.ok || resumed)) {
      if (attempt < 8 && !(res.status >= 400 && res.status < 500)) { await new Promise(r => setTimeout(r, 2000)); continue; }
      throw new Error(`Download failed (${res.status || res.message}): ${url}`);
    }
    if (!resumed) { step.done = 0; step.total = +res.headers.get('content-length') || 0; }   // server ignored Range: start over
    const out = createWriteStream(file, { flags: resumed ? 'a' : 'w' });
    try {
      for await (const chunk of res.body) { step.done += chunk.length; if (!out.write(chunk)) await new Promise(r => out.once('drain', r)); }
      await new Promise((r, j) => out.end(e => e ? j(e) : r()));
      break;
    } catch (e) {
      await new Promise(r => out.end(r));
      if (attempt >= 8) throw e;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const expectSum = (actual, expected, what) => {
  if (!expected || actual.toLowerCase() !== expected.toLowerCase()) throw new Error(`${what} failed checksum verification; nothing was installed.`);
};
const run = (exe, args) => new Promise((res, rej) => spawn(exe, args, { windowsHide: true, stdio: 'ignore' })
  .on('error', rej).on('exit', code => code ? rej(new Error(`${exe} exited with ${code}`)) : res()));

async function installFfmpeg(step) {
  const zip = join(tmpdir(), `vi-ffmpeg-${Date.now()}.zip`), tmp = join(RT, 'ffmpeg-tmp');
  try {
    const sum = await download(FFMPEG_ZIP, zip, step);
    expectSum(sum, (await (await fetch(FFMPEG_ZIP + '.sha256')).text()).trim().split(/\s+/)[0], 'ffmpeg');
    step.label = 'Unpacking ffmpeg';
    rmSync(tmp, { recursive: true, force: true }); mkdirSync(tmp, { recursive: true });
    // Windows' own bsdtar reads zip; a bare 'tar' may resolve to Git's GNU tar, which cannot.
    await run(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', zip, '-C', tmp]);
    const bin = join(tmp, readdirSync(tmp).find(d => statSync(join(tmp, d)).isDirectory()), 'bin');
    mkdirSync(join(RT, 'ffmpeg'), { recursive: true });
    for (const f of ['ffmpeg.exe', 'ffprobe.exe']) copyFileSync(join(bin, f), join(RT, 'ffmpeg', f));
  } finally { rmSync(zip, { force: true }); rmSync(tmp, { recursive: true, force: true }); }
}

async function installOllama(step) {
  const exe = join(tmpdir(), `OllamaSetup-${Date.now()}.exe`);
  try {
    const sum = await download(OLLAMA_SETUP, exe, step);
    const line = (await (await fetch(OLLAMA_SUMS)).text()).split('\n').find(l => /OllamaSetup\.exe\s*$/.test(l));
    expectSum(sum, line?.trim().split(/\s+/)[0], 'Ollama installer');
    step.label = 'Installing Ollama'; step.total = 0;
    await run(exe, ['/SP-', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']);   // per-user Inno Setup install
  } finally { rmSync(exe, { force: true }); }
  if (!await ensureOllama()) throw new Error('Ollama installed but did not start. Open Ollama once from the Start menu, then retry.');
}

async function pullModel(name, step) {
  if (!await ensureOllama()) throw new Error('Ollama is not running.');
  const res = await fetch(OLLAMA + '/api/pull', { method: 'POST', body: JSON.stringify({ model: name, stream: true }) });
  if (!res.ok) throw new Error(`Ollama could not pull ${name} (${res.status})`);
  let buf = '';
  for await (const chunk of res.body) {
    buf += Buffer.from(chunk).toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      if (msg.error) throw new Error(msg.error);
      if (msg.total) { step.total = msg.total; step.done = msg.completed || 0; }
      step.label = `Downloading ${name}: ${msg.status}`;
    }
  }
  if (!await hasModel(name)) throw new Error(`${name} did not finish downloading.`);
}

export function install({ ffmpeg, ollama, model }) {
  if (busy()) throw Object.assign(new Error('An installation is already running'), { status: 409 });
  const steps = [
    ffmpeg && { key: 'ffmpeg', label: 'Downloading ffmpeg', fn: installFfmpeg },
    ollama && { key: 'ollama', label: 'Downloading Ollama', fn: installOllama },
    model && { key: 'model', label: `Downloading ${model}`, fn: s => pullModel(model, s) },
  ].filter(Boolean).map(s => ({ ...s, done: 0, total: 0, state: 'waiting' }));
  job = { steps, finished: false, error: null };
  (async () => {
    for (const s of steps) {
      s.state = 'running';
      try { await s.fn(s); s.state = 'done'; s.label = { ffmpeg: 'ffmpeg installed', ollama: 'Ollama installed', model: `${model} downloaded` }[s.key]; }
      catch (e) { s.state = 'failed'; job.error = e.message; break; }
    }
    job.finished = true;
  })();
  return job;
}
