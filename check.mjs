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

// §32-34 standing queries fire during replay, once per watch+event
const fired = [];
await api.live({ speed: 3600, tickMs: 0, onAlert: a => fired.push(a.id) });
assert.deepEqual(fired.sort(), ['w_rear:ev_094105', 'w_van:ev_092630']);
const again = []; await api.live({ speed: 3600, tickMs: 0, onAlert: a => again.push(a) });
assert.equal(again.length, 0, 'no duplicate alerts on replay');
assert.equal(api.matchWatch({ text: 'Anyone at the east dock', scope: 'all', from: '00:00', to: '23:59' }, api.event('ev_091412'), await api.getMemory()), null);
assert.equal(api.inSchedule(api.sec('23:00:00'), { from: '20:00', to: '06:00' }), true);

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
const liveText = await (await fetch(base + 'live?speed=3600')).text();
assert.match(liveText, /event: alert/); assert.match(liveText, /event: end/);
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
  indexer.configure({ describe: null });
  srv.close();
} else console.log('(ffmpeg not installed: skipped the video pipeline check)');
rmSync(storeDir, { recursive: true, force: true });

console.log('all flows ok');
