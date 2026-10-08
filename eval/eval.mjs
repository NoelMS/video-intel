// Scores the baseline and our pipeline (with ablations) on eval/queries.json against a running server that has
// indexed the evaluation footage. Every query goes through the same HTTP API a user's search does, so latency is real.
// usage: node eval/eval.mjs [--base http://127.0.0.1:8000] [--split heldout|dev|all] [--tol 5] [--variants a,b]
//                           [--out eval/results.md]
// A result is a hit when its camera matches an answer's camera and its time lies within the answer's span +- tol
// seconds (default 5 s: the 10 s clip handed to the user contains the moment). "strict" uses +-2 s.
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const here = dirname(fileURLToPath(import.meta.url)), BASE = arg('base', 'http://127.0.0.1:8000').replace(/\/$/, '') + '/api/';
const SPLIT = arg('split', 'heldout'), TOL = +arg('tol', 5), OUT = arg('out', join(here, 'results.md'));
const H = { 'content-type': 'application/json', origin: new URL(BASE).origin };
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(b) }).then(r => r.json());
const get = p => fetch(BASE + p).then(r => r.json());

// What is compared. "labels" is the pipeline before open vocabulary (fixed label words only).
const VARIANTS = {
  baseline: { label: 'Baseline: CLIP frame retrieval (1 frame/s)' },
  labels: { label: 'Ours: detector + tracks + label words', ablation: { image: false, verify: false } },
  image: { label: 'Ours: detector + tracks + object-crop CLIP', ablation: { labels: false, verify: false } },
  hybrid: { label: 'Ours: + labels and object-crop CLIP (hybrid)', ablation: { verify: false } },
  verified: { label: 'Ours: hybrid + vision-model verification (full)', ablation: {} },
};
const chosen = arg('variants', Object.keys(VARIANTS).join(',')).split(',');

const queries = JSON.parse(readFileSync(join(here, 'queries.json'), 'utf8')).queries.filter(q => SPLIT === 'all' || q.split === SPLIT);
// Search covers one day of footage at a time (MEVA is 2018, the London clips 2026), so each query runs on the day whose
// cameras hold its answers.
const put = b => fetch(BASE + 'settings', { method: 'PUT', headers: H, body: JSON.stringify(b) });
await put({ source: 'mine' });
const videos = await get('videos'), vids = Object.fromEntries(videos.map(v => [v.id, v]));
const days = [];
for (const day of (await get('dataset')).days) {
  await put({ day });
  const d = await get('dataset');
  days.push({ day, cams: new Set(d.cameras.map(c => c.name)), camName: Object.fromEntries(d.cameras.map(c => [c.id, c.name])), events: Object.fromEntries(d.events.map(e => [e.id, e])), n: d.cameras.length });
}
const dayOf = q => days.find(d => q.answers.some(a => d.cams.has(a.camera)));
let camName = {}, events = {};
const at = (vid, vt) => Date.parse(vids[vid].start) + vt * 1000;   // absolute time of a moment in a clip

async function ours(text, ablation) {
  const t0 = Date.now(), { id } = await post('search', { text, depth: 'deep', ablation });
  const raw = await (await fetch(BASE + `search/${id}/events`)).text(), ms = Date.now() - t0;
  const block = raw.split('\n\n').map(b => b.split('\n')).find(l => l[0] === 'event: result' || l[0] === 'event: fail');
  if (!block || block[0] === 'event: fail') return { ms, list: [] };
  const r = JSON.parse(block[1].slice(6)), rejected = new Set((r.rejected || []).map(x => x.id));
  // the answer first (as shown), then the rest of the ranked candidates, best first
  const answer = r.primary ? [r.primary, ...(r.alternatives || [])] : [...(r.candidates || []), ...(r.more || []), ...(r.events || []), ...(r.journey?.sightings || [])];
  const list = [...new Set([...answer, ...(r.diag?.retrieved || []).map(x => x.id).filter(i => !rejected.has(i))])].filter(i => events[i]);
  return { ms, list: list.slice(0, 10).map(i => ({ camera: camName[events[i].cameraId], time: at(events[i].vid, events[i].vt) })) };
}
async function base(text) {
  const t0 = Date.now(), r = await post('baseline/search', { text, k: 10 });
  return { ms: Date.now() - t0, list: (r.results || []).map(x => ({ camera: camName[x.cameraId], time: at(x.vid, x.vt) })) };
}

const off = (res, a) => { const [f, t] = [Date.parse(a.from), Date.parse(a.to)]; return res.time < f ? (f - res.time) / 1000 : res.time > t ? (res.time - t) / 1000 : 0; };
const hitAt = (list, q, tol) => list.findIndex(res => q.answers.some(a => a.camera === res.camera && off(res, a) <= tol));
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const p90 = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * 0.9))] : NaN; };

const rows = [], perQuery = [];
for (const v of chosen) {
  const m = { hit1: 0, hit5: 0, rr: 0, strict1: 0, cam1: 0, dt: [], ms: [] };
  for (const q of queries) {
    const d = dayOf(q);
    if (!d) { console.log(`skipped (no indexed camera holds its answers): ${q.text}`); continue; }
    if (d.day !== days.current) { await put({ day: d.day }); days.current = d.day; ({ camName, events } = d); }
    const r = v === 'baseline' ? await base(q.text) : await ours(q.text, VARIANTS[v].ablation);
    const k = hitAt(r.list, q, TOL), ks = hitAt(r.list, q, 2);
    m.hit1 += k === 0; m.hit5 += k >= 0 && k < 5; m.rr += k >= 0 ? 1 / (k + 1) : 0; m.strict1 += ks === 0; m.ms.push(r.ms);
    const top = r.list[0];
    if (top && q.answers.some(a => a.camera === top.camera)) { m.cam1++; m.dt.push(Math.min(...q.answers.filter(a => a.camera === top.camera).map(a => off(top, a)))); }
    perQuery.push({ variant: v, id: q.id, rank: k, top: top ? `${top.camera} ${new Date(top.time).toISOString().slice(11, 19)}` : '-' });
  }
  const n = queries.length || 1;
  rows.push([VARIANTS[v].label, m.hit1 / n, m.hit5 / n, m.rr / n, m.strict1 / n, m.cam1 / n, median(m.dt), median(m.ms), p90(m.ms)]);
  console.log(`${v}: Hit@1 ${(m.hit1 / n).toFixed(3)} Hit@5 ${(m.hit5 / n).toFixed(3)} MRR ${(m.rr / n).toFixed(3)} latency ${median(m.ms)} ms`);
}

const pct = x => (x * 100).toFixed(1) + '%';
const md = [`# Evaluation: ${SPLIT} split, ${queries.length} queries (${queries.filter(q => q.kind === 'activity').length} activity, ${queries.filter(q => q.kind === 'attribute').length} attribute)`,
  '', `Hit = right camera and a time within the answer span +-${TOL} s (strict: +-2 s). Footage: ${days.reduce((n, d) => n + d.n, 0)} cameras over ${days.length} day(s), ${videos.filter(v => v.status === 'ready').length} recordings. Each query searches all cameras of its day.`, '',
  '| Method | Hit@1 | Hit@5 | MRR | Strict Hit@1 | Right camera @1 | Median time error @1 (s) | Median latency (ms) | p90 latency (ms) |',
  '|---|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r[0]} | ${pct(r[1])} | ${pct(r[2])} | ${r[3].toFixed(3)} | ${pct(r[4])} | ${pct(r[5])} | ${Number.isNaN(r[6]) ? '-' : r[6].toFixed(1)} | ${r[7]} | ${r[8]} |`),
  '', '<details><summary>Per query (rank of the first hit, -1 = none in the top 10; top result)</summary>', '',
  '| Query | ' + chosen.join(' | ') + ' |', '|---|' + chosen.map(() => '---|').join(''),
  ...queries.map(q => `| ${q.text} | ` + chosen.map(v => { const p = perQuery.find(x => x.variant === v && x.id === q.id); return `${p.rank} (${p.top})`; }).join(' | ') + ' |'),
  '', '</details>', ''].join('\n');
writeFileSync(OUT, md);
console.log(`\nwritten ${OUT}`);
