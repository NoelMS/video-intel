// Embedding retrieval with MobileCLIP (embed.mjs): the comparison baseline, and the open-vocabulary signal our pipeline
// adds to its label matching.
// - baselineSearch: the standard open-vocabulary approach the problem statement names. One embedding per second of
//   every camera, the query embedded as text, frames ranked by cosine similarity. Answer = camera + time of the best
//   frames. No detection, tracking, labels, memory or verification.
// - objectSimilarities: the same query against each tracked object's crop (our pipeline), keyed by event id.
import * as embed from './embed.mjs';
import * as indexer from './indexer.mjs';
import * as setup from './setup.mjs';
import * as api from './api.js';

// The visual part of a question: CLIP compares pictures with captions, not questions. Question words, time phrases and
// the place (a remembered referent, matched by name) are dropped: "did a red car pass through the main gate after
// 9:40?" -> "a photo of a red car".
export function phrase(text, places = []) {
  let s = ' ' + String(text).toLowerCase().replace(/[?!.]/g, ' ') + ' ';
  for (const p of places) s = s.replace(new RegExp(`\\b(through|at|in|near|by|into|past|from|to)?\\s*(the\\s+)?${p.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g'), ' ');
  s = s.replace(/\b(after|before|between|since|around|at)\s+\d{1,2}([:.]\d{2})?\s*(am|pm)?(\s+and\s+\d{1,2}([:.]\d{2})?\s*(am|pm)?)?/g, ' ')
    .replace(/\b(in\s+)?the\s+(last|past)\s+(\d+\s+)?(hour|hours|minute|minutes|min|mins)\b/g, ' ')
    .replace(/^\s*(did|was|were|is|are|has|have|show( me)?|find( me)?|where (did|was|is)|when (did|was)|look for|search for|any|is there|are there)\b/, ' ')
    .replace(/\b(pass|passed|go|went|enter|entered|leave|left|appear|appeared|come|came)\s*(through|by|past|into|out of)?\s*$/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return 'a photo of ' + (s || 'something');
}

const ready = () => embed.load(setup.DETECTOR_DIR);
const places = () => api.getMemory().then(m => m.flatMap(r => [r.name, ...(r.aliases || [])]));

// For each tracked object (event id): `objects`, the cosine between the query and the object's crop; `frames`, the best
// cosine between the query and the 1-per-second frame embeddings while the object is on screen, with that frame's
// clip time (`vt`): the moment the query best matches, e.g. when the person actually gets out of the car rather than
// when they were largest in view.
export async function similarities(text) {
  if (!await ready()) return null;
  const q = await embed.textEmbed(phrase(text, await places())), objects = new Map(), frames = new Map(), byVid = new Map();
  for (const e of api.ds().events) if (e.vid) byVid.set(e.vid, [...(byVid.get(e.vid) || []), e]);
  for (const [vid, evs] of byVid) {
    const em = indexer.embeddings(vid);
    if (!em) continue;
    const fr = [];
    em.rows.forEach((r, i) => { if (r.kind === 'track') objects.set(`${vid}_${r.tk}`, embed.cosine(q, em.vec(i))); else fr.push([r.t, embed.cosine(q, em.vec(i))]); });
    for (const e of evs) {
      const off = e.t - e.vt, ts = e.dets.map(d => d.t - off), a = Math.min(...ts) - 0.5, b = Math.max(...ts) + 0.5;
      const inside = fr.filter(([t]) => t >= a && t <= b), pool = inside.length ? inside : fr.length ? [fr.reduce((x, y) => Math.abs(y[0] - e.vt) < Math.abs(x[0] - e.vt) ? y : x)] : [];
      const best = pool.reduce((x, y) => y[1] > x[1] ? y : x, [e.vt, -1]);
      if (pool.length) frames.set(e.id, { score: best[1], vt: best[0] });
    }
  }
  return { objects, frames };
}

// top-k frames of the current day's cameras: [{ cameraId, vid, n, t (camera seconds), time, score }]
export async function baselineSearch(text, { k = 10, scope = 'all' } = {}) {
  const t0 = Date.now();
  if (!await ready()) throw Object.assign(new Error('The image search model is not installed. Open System → Local analysis.'), { status: 409 });
  const q = await embed.textEmbed(phrase(text, await places())), hits = [];
  for (const c of api.ds().cameras.filter(c => scope === 'all' || c.id === scope)) {
    const at = new Map(c.frames.map(f => [`${f.v}:${f.n}`, f.t]));
    for (const vid of new Set(c.frames.map(f => f.v))) {
      const em = indexer.embeddings(vid);
      if (!em) continue;
      em.rows.forEach((r, i) => {
        if (r.kind !== 'frame' || !at.has(`${vid}:${r.n}`)) return;
        const t = at.get(`${vid}:${r.n}`);
        hits.push({ cameraId: c.id, vid, n: r.n, vt: r.t, t, time: api.hms(c.t0 + t), score: +embed.cosine(q, em.vec(i)).toFixed(4) });
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return { query: phrase(text, await places()), results: hits.slice(0, k), searched: hits.length, ms: Date.now() - t0 };
}
