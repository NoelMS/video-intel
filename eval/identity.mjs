// Tracking identity against MEVA's own per-frame boxes (geom.yml, actor ids per camera). Only people taking part in an
// annotated activity are boxed, so this measures how well those people are found and kept as one track, not every track.
// usage: node eval/identity.mjs [--base http://127.0.0.1:8000] [--cache eval/meva/geom]
// A real person's box at one of our sampled frames is "detected" when one of our boxes overlaps it (IoU >= 0.5).
// Identity recall / precision: each person is paired with at most one of our tracks and each track with one person
// (largest overlap first); the frames where that pair agrees, over all of the person's frames / over the detected ones.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const here = dirname(fileURLToPath(import.meta.url)), BASE = arg('base', 'http://127.0.0.1:8000').replace(/\/$/, '') + '/api/';
const CACHE = arg('cache', join(here, 'meva', 'geom')), REPO = 'https://gitlab.kitware.com/meva/meva-data-repo/-/raw/master/annotation/DIVA-phase-2/MEVA/kitware/2018-03-07/11/';
const H = { 'content-type': 'application/json', origin: new URL(BASE).origin }, get = p => fetch(BASE + p).then(r => r.json());
mkdirSync(CACHE, { recursive: true });
const fetchOnce = async name => { const f = join(CACHE, name); if (!existsSync(f)) { const r = await fetch(REPO + name); if (!r.ok) throw new Error(`${name}: ${r.status}`); writeFileSync(f, await r.text()); } return readFileSync(f, 'utf8'); };
const iou = (a, b) => { const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0])), y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1])), i = x * y; return i / (a[2] * a[3] + b[2] * b[3] - i || 1); };

await fetch(BASE + 'settings', { method: 'PUT', headers: H, body: JSON.stringify({ source: 'mine', day: '2018-03-07' }) });
const d = await get('dataset'), rows = [], all = { total: 0, found: 0, idtp: 0, people: 0, tracks: 0 };
for (const stem of readdirSync(join(here, 'meva')).filter(f => f.endsWith('.activities.yml')).map(f => f.replace('.activities.yml', ''))) {
  const camName = 'MEVA ' + stem.split('.').at(-1), cam = d.cameras.find(c => c.name === camName);
  if (!cam) { console.log(`skipped (not indexed): ${camName}`); continue; }
  const person = new Set([...(await fetchOnce(stem + '.types.yml')).matchAll(/'cset3': \{'(\w+)'.*?'id1': (\d+)/g)].filter(m => m[1] === 'person').map(m => +m[2]));
  const gt = new Map();   // MEVA frame (30 fps) -> people's boxes, scaled from 1920 px to our 640 px frame space
  for (const m of (await fetchOnce(stem + '.geom.yml')).matchAll(/'g0': '(\d+) (\d+) (\d+) (\d+)'.*'id1': (\d+).*'ts0': (\d+)/g)) {
    if (!person.has(+m[5])) continue;
    const [x1, y1, x2, y2] = m.slice(1, 5).map(v => +v / 3);
    (gt.get(+m[6]) || gt.set(+m[6], []).get(+m[6])).push({ id: +m[5], box: [x1, y1, x2 - x1, y2 - y1] });
  }
  // our boxes by (clip, camera time); clip time = camera time - (event time - event clip time)
  const evs = d.events.filter(e => e.cameraId === cam.id), off = Object.fromEntries(evs.map(e => [e.vid, e.t - e.vt])), at = new Map();
  for (const e of evs) for (const x of e.dets) { const k = e.vid + '@' + x.t; (at.get(k) || at.set(k, []).get(k)).push({ track: e.track, box: x.box }); }
  const co = new Map(), seen = new Set(); let total = 0, found = 0;
  for (const f of cam.frames) {
    for (const g of gt.get(Math.round((f.t - (off[f.v] ?? 0)) * 30)) || []) {
      total++; seen.add(g.id);
      const best = (at.get(f.v + '@' + f.t) || []).map(o => [o, iou(o.box, g.box)]).sort((a, b) => b[1] - a[1])[0];
      if (!best || best[1] < 0.5) continue;
      found++; const k = g.id + '|' + best[0].track; co.set(k, (co.get(k) || 0) + 1);
    }
  }
  const pairs = [...co].map(([k, n]) => [...k.split('|'), n]).sort((a, b) => b[2] - a[2]), usedP = new Set(), usedT = new Set(); let idtp = 0;
  for (const [p, t, n] of pairs) if (!usedP.has(p) && !usedT.has(t)) { usedP.add(p); usedT.add(t); idtp += n; }
  const people = new Set(pairs.map(x => x[0])).size, tracks = pairs.length;
  rows.push([camName, `${people} of ${seen.size}`, total, found / total, idtp / total, idtp / (found || 1), tracks / (people || 1)]);
  Object.assign(all, { total: all.total + total, found: all.found + found, idtp: all.idtp + idtp, people: all.people + people, boxed: (all.boxed || 0) + seen.size, tracks: all.tracks + tracks });
  console.log(`${camName}: people ${people} of ${seen.size}, detected ${(100 * found / total).toFixed(1)}%, identity recall ${(100 * idtp / total).toFixed(1)}%, precision ${(100 * idtp / (found || 1)).toFixed(1)}%`);
}
rows.push(['All', `${all.people} of ${all.boxed}`, all.total, all.found / all.total, all.idtp / all.total, all.idtp / (all.found || 1), all.tracks / (all.people || 1)]);
const pct = x => (100 * x).toFixed(1) + '%';
writeFileSync(join(here, 'results-identity.md'), ['# Tracking identity against MEVA per-frame boxes', '',
  'People boxed by MEVA (activity actors only), sampled at our 5 fps frames. Detected: one of our boxes overlaps (IoU >= 0.5). Identity recall/precision: frames where the person\'s one assigned track is the one found, over all / over detected frames.', '',
  '| Camera | People found (of boxed) | Person-frames | Detected | Identity recall | Identity precision | Our tracks per person |', '|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r[0]} | ${r[1]} | ${r[2]} | ${pct(r[3])} | ${pct(r[4])} | ${pct(r[5])} | ${r[6].toFixed(2)} |`), ''].join('\n'));
console.log('written', join(here, 'results-identity.md'));
