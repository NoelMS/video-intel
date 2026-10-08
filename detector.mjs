// Object detector: YOLOX-S (Apache-2.0, trained on COCO) on ONNX Runtime. Boxes for every sampled frame in a fraction
// of a second, so the vision model only names each tracked object once instead of describing every frame.
// Needs onnxruntime-node and the weights, which setup.mjs installs into .runtime/detector; without them indexing falls
// back to the vision model alone.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const SIZE = 640, STRIDES = [8, 16, 32], MIN_SCORE = 0.3, NMS_IOU = 0.45;
const COCO = ['person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat', 'traffic light', 'fire hydrant', 'stop sign',
  'parking meter', 'bench', 'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella', 'handbag',
  'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
  'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza',
  'donut', 'cake', 'chair', 'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'];
// The app's entity types; other COCO classes (furniture, food, signs) are not indexed.
const TYPE = { person: 'person', bicycle: 'vehicle', car: 'vehicle', motorcycle: 'vehicle', bus: 'vehicle', train: 'vehicle', truck: 'vehicle', boat: 'vehicle',
  bird: 'animal', cat: 'animal', dog: 'animal', horse: 'animal', sheep: 'animal', cow: 'animal', backpack: 'bag', handbag: 'bag', suitcase: 'bag' };

let session = null, provider = null;
export const status = () => ({ ready: !!session, provider });
// dir holds node_modules/onnxruntime-node and yolox_s.onnx. GPU through DirectML when it loads, else the CPU.
export async function load(dir) {
  if (session) return true;
  const weights = join(dir, 'yolox_s.onnx');
  if (!existsSync(weights) || !existsSync(join(dir, 'node_modules', 'onnxruntime-node'))) return false;
  const ort = createRequire(join(dir, 'x.js'))('onnxruntime-node');
  for (const ep of process.platform === 'win32' ? ['dml', 'cpu'] : ['cpu']) {
    try { session = await ort.InferenceSession.create(weights, { executionProviders: [ep] }); provider = ep; break; } catch {}
  }
  if (session) load.Tensor = ort.Tensor;
  return !!session;
}

// Every frame of a JPEG sequence as 640x640 BGR, letterboxed top-left on grey (YOLOX's own preprocessing), from one
// ffmpeg process. Yields { pixels, luma } in order; reading on demand keeps memory flat for long recordings.
export async function* frames(ffmpeg, pattern) {
  const p = spawn(ffmpeg, ['-hide_banner', '-v', 'error', '-i', pattern, '-vf', `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease,pad=${SIZE}:${SIZE}:0:0:0x727272`,
    '-f', 'rawvideo', '-pix_fmt', 'bgr24', 'pipe:1'], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const N = SIZE * SIZE * 3;
  let buf = Buffer.alloc(0);
  for await (const chunk of p.stdout) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= N) { yield buf.subarray(0, N); buf = buf.subarray(N); }
  }
}

const iou = (a, b) => {
  const x = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return x * y / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - x * y || 1);
};

// One letterboxed frame -> objects in the app's 640x360 frame space, for a source frame of w x h pixels.
export async function detect(bgr, w, h) {
  const plane = SIZE * SIZE, data = new Float32Array(3 * plane);
  for (let i = 0; i < plane; i++) { data[i] = bgr[i * 3]; data[plane + i] = bgr[i * 3 + 1]; data[2 * plane + i] = bgr[i * 3 + 2]; }
  const out = await session.run({ [session.inputNames[0]]: new load.Tensor('float32', data, [1, 3, SIZE, SIZE]) });
  const o = out[session.outputNames[0]].data, K = 85;
  // YOLOX head output is not decoded: centre offsets and log sizes per grid cell, objectness and class scores sigmoided
  const found = [];
  let row = 0;
  for (const s of STRIDES) for (let gy = 0; gy < SIZE / s; gy++) for (let gx = 0; gx < SIZE / s; gx++, row++) {
    const r = row * K;
    let best = 0, cls = -1;
    for (let c = 0; c < 80; c++) if (o[r + 5 + c] > best) { best = o[r + 5 + c]; cls = c; }
    const score = o[r + 4] * best;
    if (score < MIN_SCORE || !TYPE[COCO[cls]]) continue;
    const cx = (o[r] + gx) * s, cy = (o[r + 1] + gy) * s, bw = Math.exp(o[r + 2]) * s, bh = Math.exp(o[r + 3]) * s;
    found.push({ cls: COCO[cls], score, b: [cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2] });
  }
  found.sort((a, b) => b.score - a.score);
  // Overlapping boxes of one class are one object; so are near-identical boxes of the same kind (a London taxi came out
  // as both "car" and "truck", and became two tracks).
  const keep = found.filter((f, i) => !found.slice(0, i).some(g => iou(g.b, f.b) > (g.cls === f.cls ? NMS_IOU : TYPE[g.cls] === TYPE[f.cls] ? 0.7 : 1)));
  // letterbox pixels -> source pixels -> 640x360 app space, clipped to the picture
  const r = Math.min(SIZE / w, SIZE / h), sx = 640 / w, sy = 360 / h;
  return keep.map(f => {
    const [x1, y1, x2, y2] = [f.b[0] / r * sx, f.b[1] / r * sy, f.b[2] / r * sx, f.b[3] / r * sy].map((n, i) => Math.max(0, Math.min(i % 2 ? 360 : 640, n)));
    return { type: TYPE[f.cls], cls: f.cls, score: +f.score.toFixed(2), box: [x1, y1, x2 - x1, y2 - y1].map(n => +n.toFixed(1)) };
  }).filter(o => o.box[2] > 2 && o.box[3] > 2);
}

// Mean brightness of the picture area (not the grey padding), for the frame's lighting.
export function lighting(bgr, w, h) {
  const r = Math.min(SIZE / w, SIZE / h), W = Math.round(w * r), H = Math.round(h * r);
  let sum = 0, n = 0;
  for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) { const i = (y * SIZE + x) * 3; sum += 0.114 * bgr[i] + 0.587 * bgr[i + 1] + 0.299 * bgr[i + 2]; n++; }
  const m = sum / n;
  return m > 85 ? 'good' : m > 40 ? 'low' : 'night';
}
