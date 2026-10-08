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

// event id -> cosine between the query and that object's crop (events without an embedding are absent)
export async function objectSimilarities(text) {
  if (!await ready()) return null;
  const q = await embed.textEmbed(phrase(text, await places())), out = new Map();
  for (const vid of new Set(api.ds().events.map(e => e.vid).filter(Boolean))) {
    const em = indexer.embeddings(vid);
    if (!em) continue;
    em.rows.forEach((r, i) => { if (r.kind === 'track') out.set(`${vid}_${r.tk}`, embed.cosine(q, em.vec(i))); });
  }
  return out;
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
        hits.push({ cameraId: c.id, vid, n: r.n, t, time: api.hms(c.t0 + t), score: +embed.cosine(q, em.vec(i)).toFixed(4) });
      });
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return { query: phrase(text, await places()), results: hits.slice(0, k), searched: hits.length, ms: Date.now() - t0 };
}
