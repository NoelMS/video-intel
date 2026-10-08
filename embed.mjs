// Vision-language embeddings: MobileCLIP-S0 (Apple, image + text towers) on the detector's ONNX Runtime. A text query
// and an image land in one vector space, so "person carrying a large bag" can be scored against any crop or frame,
// not only against the words in a label. Used for open-vocabulary search, the baseline, and cross-camera re-ID.
// Installed by setup.mjs into .runtime/detector next to the detector; without it, search falls back to labels.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SIZE = 256, CONTEXT = 77, BOS = 49406, EOS = 49407, PAD = 0;
let vision = null, text = null, Tensor = null, vocab = null, ranks = null;
export const ready = () => !!(vision && text);

export async function load(dir) {
  if (ready()) return true;
  const files = ['clip_vision.onnx', 'clip_text.onnx', 'clip_tokenizer.json'].map(f => join(dir, f));
  if (!files.every(existsSync) || !existsSync(join(dir, 'node_modules', 'onnxruntime-node'))) return false;
  const ort = createRequire(join(dir, 'x.js'))('onnxruntime-node');
  Tensor = ort.Tensor;
  for (const ep of process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu']) {
    try { vision = await ort.InferenceSession.create(files[0], { executionProviders: [ep], logSeverityLevel: 3 }); break; } catch {}
  }
  text = await ort.InferenceSession.create(files[1], { executionProviders: ['cpu'], logSeverityLevel: 3 });   // one short query at a time
  const t = JSON.parse(readFileSync(files[2], 'utf8')).model;
  vocab = t.vocab; ranks = new Map(t.merges.map((m, i) => [typeof m === 'string' ? m : m.join(' '), i]));
  return ready();
}

// ---------- CLIP byte-level BPE tokenizer ----------
const BYTE = (() => {   // GPT-2/CLIP byte -> printable unicode map
  const bs = [...Array(256).keys()].filter(b => (b >= 33 && b <= 126) || (b >= 161 && b <= 172) || b >= 174), cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  return Object.fromEntries(bs.map((b, i) => [b, String.fromCodePoint(cs[i])]));
})();
const SPLIT = /'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/gu;
function bpe(word) {
  let parts = [...word]; parts[parts.length - 1] += '</w>';
  for (;;) {
    let best = -1, rank = Infinity;
    for (let i = 0; i < parts.length - 1; i++) { const r = ranks.get(parts[i] + ' ' + parts[i + 1]); if (r !== undefined && r < rank) { rank = r; best = i; } }
    if (best < 0) return parts;
    parts = [...parts.slice(0, best), parts[best] + parts[best + 1], ...parts.slice(best + 2)];
  }
}
export function tokenize(s) {
  const ids = [BOS];
  for (const w of String(s).toLowerCase().replace(/\s+/g, ' ').trim().match(SPLIT) || [])
    for (const p of bpe([...new TextEncoder().encode(w)].map(b => BYTE[b]).join(''))) if (vocab[p] !== undefined) ids.push(vocab[p]);
  ids.length = Math.min(ids.length, CONTEXT - 1); ids.push(EOS);
  return [...ids, ...Array(CONTEXT - ids.length).fill(PAD)];
}

// ---------- encoders (unit-length vectors, so a dot product is the cosine) ----------
const unit = v => { let n = 0; for (const x of v) n += x * x; n = Math.sqrt(n) || 1; return Float32Array.from(v, x => x / n); };
export const cosine = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const textCache = new Map();
export async function textEmbed(s) {
  const key = String(s).toLowerCase().trim();
  if (!textCache.has(key)) {
    const ids = BigInt64Array.from(tokenize(key), BigInt);
    const out = await text.run({ [text.inputNames[0]]: new Tensor('int64', ids, [1, CONTEXT]) });
    textCache.set(key, unit(out[text.outputNames[0]].data));
    if (textCache.size > 500) textCache.delete(textCache.keys().next().value);
  }
  return textCache.get(key);
}

// rgb: SIZE x SIZE x 3 bytes (HWC). Pixels scaled to 0-1, no mean/std (MobileCLIP's preprocessing).
export async function imageEmbed(rgb) {
  const plane = SIZE * SIZE, data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) { data[i] = rgb[i * 3] / 255; data[plane + i] = rgb[i * 3 + 1] / 255; data[2 * plane + i] = rgb[i * 3 + 2] / 255; }
  const out = await vision.run({ [vision.inputNames[0]]: new Tensor('float32', data, [1, 3, SIZE, SIZE]) });
  return unit(out[vision.outputNames[0]].data);
}

// A square region of a BGR picture (stride `w`, the detector's frame buffer), resized bilinearly to SIZE x SIZE RGB.
// Regions outside the picture read as mid grey, like the detector's padding.
export function squareCrop(bgr, w, h, [x, y, side]) {
  const out = new Uint8Array(SIZE * SIZE * 3), k = side / SIZE;
  for (let oy = 0; oy < SIZE; oy++) for (let ox = 0; ox < SIZE; ox++) {
    const sx = x + (ox + 0.5) * k - 0.5, sy = y + (oy + 0.5) * k - 0.5, x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
    for (let c = 0; c < 3; c++) {
      const px = (xx, yy) => xx < 0 || yy < 0 || xx >= w || yy >= h ? 114 : bgr[(yy * w + xx) * 3 + (2 - c)];
      const v = px(x0, y0) * (1 - fx) * (1 - fy) + px(x0 + 1, y0) * fx * (1 - fy) + px(x0, y0 + 1) * (1 - fx) * fy + px(x0 + 1, y0 + 1) * fx * fy;
      out[(oy * SIZE + ox) * 3 + c] = v;
    }
  }
  return out;
}
