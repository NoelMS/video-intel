// node check.mjs — asserts the spec's test flows against the mock pipeline.
import assert from 'node:assert/strict';
import * as api from './api.js';

const s = (q, o = {}) => api.search(q, { speed: 0, ...o });

let r = await s('Did a red car pass through the main gate?');                       // flow 1
assert.equal(r.status, 'supported'); assert.equal(r.primary, 'ev_091412');
assert.ok(r.rejected.some(x => x.id === 'ev_091744'), 'maroon SUV rejected as negative evidence');

r = await s('What happened near the loading area?');                                // flow 2
assert.equal(r.status, 'activity'); assert.deepEqual(r.events, ['ev_092630', 'ev_092910']);

r = await s('Did anyone enter the north gate?');                                    // flow 3
assert.equal(r.status, 'clarify'); assert.equal(r.interp.location.term, 'north gate');
await api.createMemory({ name: 'North Gate', cameraId: 'cam_02', region: [250, 150, 120, 180] });
r = await s('Did anyone enter the north gate?');                                    // flow 4 (persisted)
assert.equal(r.status, 'supported'); assert.equal(r.primary, 'ev_093320');

r = await s('Where did the red car go?');                                           // flow 5
assert.equal(r.status, 'journey'); assert.deepEqual(r.journey.sightings, ['ev_091412', 'ev_091548', 'ev_091703', 'ev_092241']);
r = await s('Where did it go?', { context: { track: 'P11' } });
assert.deepEqual(r.journey.sightings, ['ev_093320', 'ev_093610', 'ev_094105']);
assert.ok(r.journey.transitions[1].gaps.some(g => g.cameraId === 'cam_07'), 'journey surfaces CAM 07 gap');

r = await s('Find the person carrying a large black bag');                          // flows 6 + 9
assert.equal(r.status, 'ambiguous'); assert.equal(r.candidates.length, 2);

r = await s('Did the maroon suv pass through the main gate?');                      // flow 7
assert.equal(r.status, 'refusal');

r = await s('Did anyone enter the lobby after 9:40?');                              // flow 8
assert.equal(r.status, 'empty'); assert.ok(r.coverage.some(g => g.cameraId === 'cam_07' && g.kind === 'gap'));

r = await s('Did a red car pass through the main gate?', { depth: 'fast' });          // §155 depth has a real effect
assert.equal(r.diag.cross, false); assert.equal(r.funnel.find(f => f.stage === 'cross_camera').count, null);
assert.equal(api.assess(api.event(r.primary), r.interp, { cross: false }).at(-1)[1], 'NOT CHECKED');
r = await s('Find a red car', { depth: 'deep' });
assert.equal(r.diag.retrieved.length, 6); assert.equal(r.status, 'supported');

// §68 privacy: expiry/retention enforced on read; reveal needs supervisor and is audited
const old = new Date(Date.now() - 100 * 864e5).toISOString();
const kv = new Map([['vi.saved', JSON.stringify([{ eventId: 'ev_091412', savedAt: old }])], ['vi.history', JSON.stringify([{ text: 'x', at: old, status: 'empty', n: 0 }])]]);
api.useStorage({ getItem: k => kv.get(k) ?? null, setItem: (k, v) => kv.set(k, v) });
assert.equal((await api.getSaved())[0].expired, true); assert.equal((await api.getHistory()).length, 0);
await assert.rejects(api.addAudit({ action: 'reveal', eventId: 'ev_091412' }), /supervisor/);
await api.setSettings({ operator: { role: 'supervisor' } });
await api.addAudit({ action: 'reveal', eventId: 'ev_091412', role: 'supervisor' });
assert.equal((await api.getAudit()).length, 1);

// §33-34 standing queries match exactly what they describe, once per watch+event
const refs0 = await api.getMemory(), ws = (await api.getWatches()).filter(w => w.status === 'active'), hits0 = [];
for (const e of api.ds().events) for (const w of ws) if (api.matchWatch(w, e, refs0)) hits0.push([w, e]);
const fired = []; for (const [w, e] of hits0) { const a = await api.addAlert(w, e); if (a) fired.push(a.id); }
assert.deepEqual(fired.sort(), ['w_rear:ev_094105', 'w_van:ev_092630']);
for (const [w, e] of hits0) assert.equal(await api.addAlert(w, e), null, 'no duplicate alerts');
assert.equal(api.matchWatch({ text: 'Anyone at the east dock', scope: 'all', from: '00:00', to: '23:59' }, api.event('ev_091412'), await api.getMemory()), null);
assert.equal(api.inSchedule(api.sec('23:00:00'), { from: '20:00', to: '06:00' }), true);
// a thing no label names is a find (refused by the checks), never "what happened"; a watch for it never fires
assert.equal(api.interpret('Find an elephant', []).intent, 'find');
assert.equal(api.interpret('What happened after 9:40?', []).intent, 'activity');
// a clip starting 5 s late is not an unsearched gap; one starting a minute late is
assert.equal(api.coverageGaps([{ id: 'c', coverage: [['10:00:05', '10:05:00']] }], [36000, 36300]).length, 0);
assert.equal(api.coverageGaps([{ id: 'c', coverage: [['10:01:00', '10:05:00']] }], [36000, 36300]).length, 1);
// the kind of vehicle is kept: a red truck is not any red vehicle; a car park is a place, not a car
assert.equal(api.interpret('Find a red truck', []).kind.name, 'truck');
assert.equal(api.interpret('Find a white pickup truck', []).kind.name, 'pickup');
assert.equal(api.interpret('Find a lorry', []).kind.name, 'truck');
assert.equal(api.interpret('Find the scooter rider in a white helmet', []).entity, 'person');
assert.equal(api.interpret('Find the people walking across the car park', []).kind, null);
{ const q = api.interpret('Find a red truck', []), ev = (label, attrs) => ({ entity: 'vehicle', attrs, time: '10:00:00' });
  assert.equal(api.checks(ev('Red car', ['red', 'car']), q, [0, 86400]).find(c => c.text === 'Kind · truck').ok, false);
  assert.equal(api.checks(ev('Red lorry', ['red', 'lorry']), q, [0, 86400]).every(c => c.ok), true);
  assert.equal(api.checks(ev('Red saloon', ['red', 'saloon']), api.interpret('Find a red car', []), [0, 86400]).every(c => c.ok), true); }
// a free-form area: a path through the corner of its bounding box that misses the outline is not a crossing
{ const tri = [[100, 100], [300, 100], [100, 300]], box = [100, 100, 200, 200];
  assert.equal(api.inside([150, 150], box, tri), true);
  assert.equal(api.inside([280, 280], box, tri), false);
  assert.equal(api.inside([280, 280], box), true);
  assert.equal(api.pathHits({ path: [[290, 250], [250, 290]] }, box, tri), false);
  assert.equal(api.pathHits({ path: [[50, 150], [250, 150]] }, box, tri), true); }
// a vehicle named anywhere is the search target (measured: see interpret)
assert.equal(api.interpret('Find a person getting out of a car', []).entity, 'vehicle');
// a specific place is asked about; "the door of a building" is any door
assert.equal(api.interpret('Did a white van cross the junction?', []).location?.term, 'junction');
assert.equal(api.interpret('Find a person opening the door of a building', []).location, null);
assert.equal(api.interpret('Find a person opening the door of the bank', []).location?.term, 'door');
assert.equal(api.matchWatch({ text: 'Notify me if an elephant appears', scope: 'all', from: '00:00', to: '23:59' }, api.event('ev_091412'), []), false);

// §63 evidence board ordering
await api.saveEvidence('ev_091548', 'q'); await api.saveJourney('A17', 'q'); await api.saveEvidence('ev_092630', 'q');
await api.moveItem('journey:A17', 'primary', 0); await api.moveItem('ev_092630', 'primary', 0); await api.moveItem('ev_091548', 'primary', 5);
assert.deepEqual((await api.getSaved()).filter(x => x.lane === 'primary').map(x => x.id), ['ev_092630', 'journey:A17', 'ev_091548']);
await api.removeEvidence('journey:A17');
assert.ok(!(await api.getSaved()).some(x => x.id === 'journey:A17'));

// server: persistence + validation + SSE stages
const { start } = await import('./server.mjs');
const { tmpdir } = await import('node:os');
const { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync } = await import('node:fs');
const storeDir = mkdtempSync(`${tmpdir()}/vi-check-`), store = `${storeDir}/store.json`;
let srv = await start(0, store);
const base = `http://localhost:${srv.address().port}/api/`;
const call = (p, method = 'GET', body, headers = { 'content-type': 'application/json' }) => fetch(base + p, { method, headers, body: body && JSON.stringify(body) }).then(async r => [r.status, await r.json()]);
// browser-facing guards: cross-site "simple" POSTs, foreign origins and rebinding Hosts are refused
assert.equal((await call('memory', 'POST', { name: 'X', cameraId: 'cam_02', region: [0, 0, 50, 50] }, { 'content-type': 'text/plain' }))[0], 415);
assert.equal((await call('settings', 'PUT', { depth: 'fast' }, { 'content-type': 'application/json', origin: 'https://evil.example' }))[0], 403);
const { get } = await import('node:http');
const rebound = await new Promise(r => get({ host: '127.0.0.1', port: srv.address().port, path: '/api/health', headers: { host: 'evil.example' } }, res => r(res.statusCode)));
assert.equal(rebound, 421);
assert.equal((await call('health'))[1].stale, false, 'freshly started server is not stale');
assert.equal((await call('memory', 'POST', { name: 'Bad', cameraId: 'cam_02', region: [600, 0, 100, 10] }))[0], 400, 'region outside frame rejected');
assert.equal((await call('memory', 'POST', { name: 'East Gate', cameraId: 'cam_02', region: [250, 150, 120, 180] }))[0], 200);
const [, { id }] = await call('search', 'POST', { text: 'Did anyone enter the east gate?' });
const sse = await (await fetch(base + `search/${id}/events`)).text();
assert.match(sse, /event: stage/); assert.match(sse, /event: result\ndata: .*"status":"supported"/);
assert.equal((await call('audit', 'POST', { action: 'reveal', eventId: 'ev_091412' }))[0], 403, 'analyst cannot reveal');
assert.equal((await call('settings', 'PUT', { privacy: { exports: 'leak' } }))[0], 400);
assert.equal((await call('watches', 'POST', { text: 'x', scope: 'all', from: '25:00', to: '06:00' }))[0], 400, 'bad schedule rejected');
// uploads: metadata is validated before a byte is stored
const up = (qs, type = 'video/mp4', bytes = 'x') => fetch(base + 'videos?' + new URLSearchParams(qs), { method: 'POST', headers: { 'content-type': type }, body: bytes }).then(r => r.status);
const meta = { name: 'Dock East', location: 'Warehouse', tz: 'Asia/Kolkata', start: '2026-10-08T09:00:00Z', filename: 'dock.mp4' };
assert.equal(await up({ ...meta, tz: 'Mars/Olympus' }), 400, 'bad timezone rejected');
assert.equal(await up({ ...meta, filename: 'run.exe' }), 400, 'non-video file type rejected');
assert.equal(await up(meta, 'text/plain'), 415, 'cross-site simple upload refused');
assert.equal((await call('saved', 'POST', { track: 'A17' }))[0], 200);
assert.equal((await call('saved/journey%3AA17', 'PUT', { lane: 'primary', index: 0 }))[0], 200);
assert.equal((await call('saved/journey%3AA17', 'PUT', { lane: 'nowhere', index: 0 }))[0], 400);
srv.close();
srv = await start(0, store);                                                         // restart: memory persists
assert.equal(srv.address().address, '127.0.0.1', 'server is not exposed to the network');
const mem = await (await fetch(`http://localhost:${srv.address().port}/api/memory`)).json();
assert.ok(mem.some(r => r.name === 'East Gate'), 'referent survives server restart');
srv.close();


// icon-launched server exits on its own once idle
const { spawn } = await import('node:child_process');
const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: '8799', VI_IDLE_EXIT: '1500', VI_STORE: store } });
const exitCode = await new Promise((res, rej) => { child.on('exit', res); setTimeout(() => { child.kill(); rej(new Error('idle server did not exit')); }, 20000); });
assert.equal(exitCode, 0);

// indexer: frame-to-frame tracking is a pure function
const indexer = await import('./indexer.mjs');
const person = (n, t, x) => ({ n, t, lighting: 'good', objects: [{ type: 'person', label: 'man in red jacket', colors: ['red'], attributes: ['jacket'], action: 'walking', box: [x, 100, 40, 120], visibility: 'clear' }] });
const tr = indexer.track([person(1, 0, 100), person(2, 2, 110), person(3, 4, 400), person(4, 30, 405)], 6);
assert.deepEqual(tr.map(t => t.dets.map(d => d.n)), [[1, 2], [3], [4]], 'overlap links, a jump or a long gap starts a new track');

// time phrases: ranges, "at" (+-5 min), parts of the day, and "last hour" measured back from the end of the footage
{
  const tw = t => api.timeWindow(` ${t} `);
  assert.deepEqual(tw('person between 9 and 9:30'), { after: 32400, before: 34200 });
  assert.deepEqual(tw('red car in the last hour'), { recent: 3600 });
  assert.deepEqual(tw('in the last half hour'), { recent: 1800 });
  assert.deepEqual(tw('anyone at 9:14'), { after: 32940, before: 33540 });
  assert.deepEqual(tw('van after 9:40pm'), { after: 78000, before: null });
  assert.deepEqual(tw('someone at the main gate'), { after: null, before: null }, '"at" a place is not a time');
}
// open vocabulary: the visual phrase CLIP sees, and the blend of image similarity with label words
{
  const { phrase } = await import('./baseline.mjs');
  assert.equal(phrase('Did a red car pass through the main gate after 9:40?', ['Main Gate']), 'a photo of a red car');
  assert.equal(phrase('Find the person carrying a large bag in the last hour'), 'a photo of the person carrying a large bag');
  const ev = (id, attrs) => ({ id, attrs, conf: { semantic: 0.5, visual: 0.5 } }), pool = [ev('a', ['red']), ev('b', []), ev('c', ['red'])];
  const q = { attrs: ['red'] }, sim = new Map([['a', 0.10], ['b', 0.30], ['c', 0.25]]), r = api.openVocab(pool, q, sim);
  assert.ok(r(pool[2]) > r(pool[0]), 'among label matches, the better picture ranks first');
  assert.ok(r.pass(pool[0]) && r.pass(pool[2]), 'a full label match always passes');
  assert.ok(!api.openVocab(pool, q, null).pass(pool[1]), 'without embeddings, labels decide (as before)');
  const nolabel = api.openVocab(pool, { attrs: [] }, sim);
  assert.ok(nolabel.pass(pool[1]) && !nolabel.pass(pool[0]), 'words outside the vocabulary: the picture decides');
}
// CLIP tokenizer matches CLIP's ids (when the image-search model is installed)
{
  const setupM = await import('./setup.mjs'), E = await import('./embed.mjs');
  if (setupM.detectorOk() && await E.load(setupM.DETECTOR_DIR)) assert.deepEqual(E.tokenize('a photo of a cat').slice(0, 8), [49406, 320, 1125, 539, 320, 2368, 49407, 0]);
}

// vision model replies: JSON in content (Ollama 0.40) or in thinking after reasoning (0.31), never the reasoning itself
{
  const { jsonIn } = await import('./indexer.mjs');
  assert.deepEqual(jsonIn('{"objects":[]}'), { objects: [] });
  assert.deepEqual(jsonIn('<think>\nGo look {not json}</think>\n{"objects":[1]}'), { objects: [1] });
  assert.equal(jsonIn('<think>\nSo, the frame shows a bus {maybe}'), null, 'unfinished reasoning is not parsed as JSON');
  assert.equal(jsonIn(''), null);
  // streamed reply: the object list ends where the model starts stepping one object sideways (real reply, shortened)
  const { streamedObjects } = await import('./indexer.mjs');
  const head = '{"faces":[[544,0,700,250]],"plates":[],"lighting":"low",\n "objects":[', o = (l, b) => `{"type":"person","label":"${l}","box":[${b}],"action":"standing"}`;
  const s = streamedObjects(head + [o('woman in white top', '93,584,148,725'), o('man in dark jacket', '848,445,878,545'), o('man in dark jacket', '878,445,908,545')].join(',\n  '));
  assert.ok(s.loop); assert.deepEqual(s.objects.map(x => x.box[0]), [93, 848]); assert.deepEqual(jsonIn(s.head.replace(/,\s*$/, '') + '}').faces, [[544, 0, 700, 250]]);
  assert.equal(streamedObjects(head + [o('man in dark jacket', '848,445,878,545'), o('man in dark jacket', '100,600,140,720'), '{"type":"per'].join(',')).loop, false, 'same label elsewhere is a different person');
}

// installer downloads resume after a dropped connection and still hash the whole file
{
  const { createServer } = await import('node:http'), { createHash, randomBytes } = await import('node:crypto');
  const blob = randomBytes(300000); let dropped = false;
  const ds = createServer((req, res) => {
    const from = +(/bytes=(\d+)-/.exec(req.headers.range || '')?.[1] || 0);
    res.writeHead(from ? 206 : 200, { 'content-length': blob.length - from });
    if (!dropped) { dropped = true; res.write(blob.subarray(0, 120000)); return setTimeout(() => res.socket.destroy(), 50); }
    res.end(blob.subarray(from));
  }).listen(0);
  const { download } = await import('./setup.mjs'), step = {}, file = `${storeDir}/dl.bin`;
  const sum = await download(`http://127.0.0.1:${ds.address().port}/f`, file, step);
  assert.equal(sum, createHash('sha256').update(blob).digest('hex'), 'resumed download is byte-identical');
  assert.equal(step.done, blob.length);
  ds.close();
}

// full pipeline on a real (generated) video with ffmpeg, a stand-in for the vision model, and search over it
const { ffmpegPath } = await import('./setup.mjs');
if (ffmpegPath()) {
  srv = await start(0, store);
  const b2 = `http://localhost:${srv.address().port}/api/`;
  const clip = `${storeDir}/clip.mp4`;
  await new Promise((res, rej) => spawn(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=320x180:rate=10', '-pix_fmt', 'yuv420p', clip])
    .on('exit', c => c ? rej(new Error('ffmpeg test clip failed')) : res()));
  let k = 0;
  indexer.configure({ describe: async () => ({ objects: [{ ...person(0, 0, 100 + 20 * k++).objects[0] }], faces: [[10, 10, 20, 20]], plates: [], lighting: 'good' }) });
  // a standing query set before the footage arrives fires when the recording finishes indexing
  await fetch(b2 + 'watches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'man in a red jacket', scope: 'all', from: '00:00', to: '23:59' }) });
  await fetch(b2 + 'watches', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Notify me if a red bus appears', scope: 'all', from: '00:00', to: '23:59' }) });
  const r = await fetch(b2 + 'videos?' + new URLSearchParams({ ...meta, filename: 'clip.mp4' }), { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: (await import('node:fs')).readFileSync(clip) });
  assert.equal(r.status, 200, await r.clone().text());
  for (let i = 0; i < 100 && (await (await fetch(b2 + 'videos')).json())[0].status !== 'ready'; i++) await new Promise(res => setTimeout(res, 200));
  const vid = (await (await fetch(b2 + 'videos')).json())[0];
  assert.equal(vid.status, 'ready', JSON.stringify(vid));
  assert.equal(Math.round(vid.duration), 8);
  await fetch(b2 + 'settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mine' }) });
  const mine = await (await fetch(b2 + 'dataset')).json();
  assert.equal(mine.cameras.length, 1); assert.ok(mine.events.length >= 1 && mine.events[0].attrs.includes('red'));
  assert.equal((await fetch(b2 + `videos/${vid.id}/frames/1`)).headers.get('content-type'), 'image/jpeg');
  const ranged = await fetch(b2 + `videos/${vid.id}/file`, { headers: { range: 'bytes=0-99' } });
  assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 100);
  const [, { id: sid }] = await (async () => { const x = await fetch(b2 + 'search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'Find the man in a red jacket', depth: 'fast' }) }); return [x.status, await x.json()]; })();
  assert.match(await (await fetch(b2 + `search/${sid}/events`)).text(), /"status":"supported"/, 'search runs over indexed footage');
  assert.ok(mine.events[0].dets.length > 1, 'events carry per-frame boxes for playback overlays');
  let alerts = [];
  for (let i = 0; i < 50 && !alerts.length; i++) { alerts = await (await fetch(b2 + 'alerts')).json(); if (!alerts.length) await new Promise(res => setTimeout(res, 100)); }
  assert.ok(alerts.some(a => a.watchText === 'man in a red jacket' && a.eventId.startsWith(vid.id)), 'standing query alerts on newly indexed real footage');
  assert.ok(!alerts.some(a => /bus/.test(a.watchText)), 'a watch for a red bus does not fire on a man in a red jacket');
  assert.ok(!existsSync(indexer.playFile(vid)), 'browser-playable H.264 source gets no copy');
  // H.265 (what most CCTV exports) gets an H.264 copy, served at /play; /file stays the untouched source
  const hevc = `${storeDir}/cctv.mkv`;
  await new Promise((res, rej) => spawn(ffmpegPath(), ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x180:rate=10', '-c:v', 'libx265', '-pix_fmt', 'yuv420p', hevc])
    .on('exit', c => c ? rej(new Error('ffmpeg hevc clip failed')) : res()));
  await fetch(b2 + 'videos?' + new URLSearchParams({ ...meta, name: 'Rear', filename: 'cctv.mkv' }), { method: 'POST', headers: { 'content-type': 'video/x-matroska' }, body: readFileSync(hevc) });
  const h = async () => (await (await fetch(b2 + 'videos')).json()).find(v => v.name === 'Rear');
  for (let i = 0; i < 150 && (await h()).status !== 'ready'; i++) await new Promise(res => setTimeout(res, 200));
  const hv = await h();
  assert.equal(hv.status, 'ready', JSON.stringify(hv)); assert.equal(hv.codec, 'hevc');
  assert.equal((await fetch(b2 + `videos/${hv.id}/play`)).headers.get('content-type'), 'video/mp4');
  assert.equal((await fetch(b2 + `videos/${hv.id}/file`)).headers.get('content-type'), 'video/x-matroska');
  const probed = await indexer.probe(indexer.playFile(hv));
  assert.equal(probed.codec, 'h264'); assert.equal(Math.round(probed.duration), 4);
  // an unusable model reply skips that frame; a model that never answers in JSON fails the recording quickly
  const bad = () => Object.assign(new Error('The vision model did not return JSON.'), { badReply: true });
  const up2 = async name => { await fetch(b2 + 'videos?' + new URLSearchParams({ ...meta, name, filename: 'clip.mp4' }), { method: 'POST', headers: { 'content-type': 'video/mp4' }, body: readFileSync(clip) });
    for (let i = 0; i < 150; i++) { const v = (await (await fetch(b2 + 'videos')).json()).find(x => x.name === name); if (['ready', 'failed'].includes(v.status)) return v; await new Promise(res => setTimeout(res, 200)); } };
  let calls = 0;
  indexer.configure({ describe: async () => { if (++calls <= 2) throw bad(); return { objects: [], faces: [], plates: [], lighting: 'good' }; } });
  const flaky = await up2('Flaky');
  assert.equal(flaky.status, 'ready', JSON.stringify(flaky)); assert.equal(flaky.skipped, 1, 'one frame failed twice and was skipped'); assert.equal(flaky.found, 0);
  calls = 0;
  indexer.configure({ describe: async () => { calls++; throw bad(); } });
  const broken = await up2('Broken');
  assert.equal(broken.status, 'failed'); assert.match(broken.error, /could not be analysed: The vision model did not return JSON/);
  assert.ok(calls <= 10, 'gives up after at most 5 frames (2 tries each)');
  indexer.configure({ describe: null });
  srv.close();
} else console.log('(ffmpeg not installed: skipped the video pipeline check)');

// object detector, when installed: loads, reads frames from ffmpeg, finds nothing in a blank frame, judges brightness
const setupMod = await import('./setup.mjs');
if (setupMod.detectorOk() && setupMod.ffmpegPath()) {
  const det = await import('./detector.mjs'), { spawn } = await import('node:child_process');
  assert.ok(await det.load(setupMod.DETECTOR_DIR), 'detector loads');
  for (const [colour, light] of [['white', 'good'], ['black', 'night']]) {
    const jpg = `${storeDir}/${colour}-000001.jpg`;
    mkdirSync(storeDir, { recursive: true });
    await new Promise(r => spawn(setupMod.ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=${colour}:s=352x288:d=1`, '-frames:v', '1', jpg]).on('exit', r));
    let n = 0;
    for await (const px of det.frames(setupMod.ffmpegPath(), `${storeDir}/${colour}-%06d.jpg`)) {
      n++; assert.deepEqual(await det.detect(px, 352, 288), [], `nothing in a ${colour} frame`); assert.equal(det.lighting(px, 352, 288), light);
    }
    assert.equal(n, 1);
  }
} else console.log('(object detector not installed: skipped its check)');
rmSync(storeDir, { recursive: true, force: true });

// fast capture: manual "Start capture", or an active standing query for this camera (or all) inside its hours
{
  const sources = await import('./sources.mjs'), mem = new Map(), cam = { cameraKey: 'feed-a' };
  sources.useStorage((k, d) => mem.get(k) ?? d, (k, v) => mem.set(k, v));
  const w = (scope, from, to, status = 'active', text = 'a person') => ({ text, scope, from, to, status });
  assert.equal(sources.fastWhy({ ...cam, fast: true }), 'started manually');
  mem.set('vi.watches', [w('feed-b', '00:00', '23:59'), w('all', '00:00', '23:59', 'paused')]);
  assert.equal(sources.fastWhy(cam), null, 'other camera / paused watch');
  mem.set('vi.watches', [w('feed-a', '00:00', '23:59')]);
  assert.equal(sources.fastWhy(cam), 'standing query hours');
  // a query naming a place speeds up only the camera the place is on (the demo's seeded queries name demo cameras)
  mem.set('vi.watches', [w('all', '00:00', '23:59', 'active', 'White van at the loading area')]);
  mem.set('vi.memory', [{ id: 'r', name: 'Loading Area', cameraId: 'cam_08', region: [0, 0, 10, 10] }]);
  assert.equal(sources.fastWhy(cam), null, 'a place on another camera');
  mem.set('vi.memory', [{ id: 'r', name: 'Loading Area', cameraId: 'feed-a', region: [0, 0, 10, 10] }]);
  assert.equal(sources.fastWhy(cam), 'standing query hours', 'the place is on this camera');
}

console.log('all flows ok');
