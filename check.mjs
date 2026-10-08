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

// server: persistence + validation + SSE stages
const { start } = await import('./server.mjs');
const { tmpdir } = await import('node:os');
const store = `${tmpdir()}/vi-check-${Date.now()}.json`;
let srv = await start(0, store);
const base = `http://localhost:${srv.address().port}/api/`;
const call = (p, method = 'GET', body) => fetch(base + p, { method, body: body && JSON.stringify(body) }).then(async r => [r.status, await r.json()]);
assert.equal((await call('memory', 'POST', { name: 'Bad', cameraId: 'cam_02', region: [600, 0, 100, 10] }))[0], 400, 'region outside frame rejected');
assert.equal((await call('memory', 'POST', { name: 'East Gate', cameraId: 'cam_02', region: [250, 150, 120, 180] }))[0], 200);
const [, { id }] = await call('search', 'POST', { text: 'Did anyone enter the east gate?' });
const sse = await (await fetch(base + `search/${id}/events`)).text();
assert.match(sse, /event: stage/); assert.match(sse, /event: result\ndata: .*"status":"supported"/);
assert.equal((await call('audit', 'POST', { action: 'reveal', eventId: 'ev_091412' }))[0], 403, 'analyst cannot reveal');
assert.equal((await call('settings', 'PUT', { privacy: { exports: 'leak' } }))[0], 400);
assert.equal((await call('watches', 'POST', { text: 'x', scope: 'all', from: '25:00', to: '06:00' }))[0], 400, 'bad schedule rejected');
const reg = { name: 'Dock East', location: 'Warehouse', tz: 'Asia/Kolkata', source: { kind: 'file', name: 'a.mp4', size: 10, type: 'video/mp4' }, start: '2026-10-08T09:00:00Z' };
assert.equal((await call('registrations', 'POST', { ...reg, tz: 'Mars/Olympus' }))[0], 400, 'bad timezone rejected');
assert.equal((await call('registrations', 'POST', { ...reg, thumbs: ['data:text/html,<script>'] }))[0], 400, 'non-jpeg thumb rejected');
assert.equal((await call('registrations', 'POST', { ...reg, source: { kind: 'url', url: 'javascript:alert(1)' } }))[0], 400);
const [okReg, row] = await call('registrations', 'POST', reg);
assert.equal(okReg, 200); assert.equal(row.status, 'frames-extracted');
const liveText = await (await fetch(base + 'live?speed=3600')).text();
assert.match(liveText, /event: alert/); assert.match(liveText, /event: end/);
srv.close();
srv = await start(0, store);                                                         // restart: memory persists
const mem = await (await fetch(`http://localhost:${srv.address().port}/api/memory`)).json();
assert.ok(mem.some(r => r.name === 'East Gate'), 'referent survives server restart');
srv.close();
(await import('node:fs')).rmSync(store);

console.log('all flows ok');
