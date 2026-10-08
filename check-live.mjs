// node check-live.mjs — needs the internet and ffmpeg. Exercises the real public sources end to end with a stand-in
// vision model: a TfL clip, two Caltrans HLS captures (one camera, two clips), a MEVA archive import, and validation.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { start } from './server.mjs';
import * as indexer from './indexer.mjs';
import * as sources from './sources.mjs';

const dir = mkdtempSync(`${tmpdir()}/vi-live-`), srv = await start(0, `${dir}/store.json`);
const base = `http://localhost:${srv.address().port}/api/`;
const call = async (p, method = 'GET', body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) }); return [r.status, await r.json()]; };
const until = async (fn, ms = 180000) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise(r => setTimeout(r, 1000))) { const v = await fn(); if (v) return v; } throw new Error('timed out'); };
indexer.configure({ describe: async () => ({ objects: [{ type: 'vehicle', label: 'white car', action: 'driving', box: [100, 100, 80, 40] }], faces: [], plates: [], lighting: 'good' }) });

// directories
const [, tfl] = await call('sources/tfl'); assert.ok(tfl.length > 500, 'TfL lists its cameras');
const [, ct] = await call('sources/caltrans/7'); assert.ok(ct.length > 100, 'Caltrans district 7 lists live streams');
const [, mv] = await call('sources/meva?prefix=' + encodeURIComponent('drops-123-r13/2018-03-05/09/')); assert.ok(mv.files.length > 5);
assert.equal((await call('sources/caltrans/13'))[0], 400);
assert.equal((await call('sources/meva?prefix=' + encodeURIComponent('drops-123-r13/../x')))[0], 400);
assert.equal((await call('feeds', 'POST', { items: [{ name: 'x', tz: 'UTC', url: 'file:///c:/windows', kind: 'clip', intervalMin: 5 }] }))[0], 400, 'only http(s)/rtsp feeds');
assert.equal((await call('imports', 'POST', { meva: [{ key: '../../etc/passwd' }] }))[0], 400, 'MEVA keys must be archive clips');

// live feeds: one TfL clip camera, one Caltrans stream recorded twice
const cam = tfl.find(c => c.available);
const live = ct[0];
await call('feeds', 'POST', { items: [
  { name: cam.name, location: 'London', tz: 'Europe/London', url: cam.url, kind: 'clip', intervalMin: 2, provider: 'tfl' },
  { name: live.name, location: 'Los Angeles', tz: 'America/Los_Angeles', url: live.url, kind: 'stream', clipSec: 6, intervalMin: 2, provider: 'caltrans' },
] });
const [, again] = await call('feeds', 'POST', { items: [{ name: cam.name, tz: 'Europe/London', url: cam.url, kind: 'clip', intervalMin: 5 }] });
assert.equal(again.added, 0, 'the same camera is not added twice');
const ready = name => async () => (await (await fetch(base + 'videos')).json()).filter(v => v.name === name && v.status === 'ready');
console.log('waiting for the first TfL and Caltrans captures to be indexed...');
await until(async () => (await ready(cam.name)()).length >= 1);
await until(async () => (await ready(live.name)()).length >= 1);
// force a second Caltrans capture and a second TfL fetch (TfL answers 304 until the camera publishes a new clip)
const feeds = (await call('ingest'))[1].feeds;
for (const f of feeds) sources.updateFeed(f.id, { next: 0 });
console.log('waiting for the second Caltrans capture...');
await until(async () => (await ready(live.name)()).length >= 2);
const tflFeed = (await call('ingest'))[1].feeds.find(f => f.provider === 'tfl');
assert.match(tflFeed.state, /Captured|No new clip/, tflFeed.state);

await call('settings', 'PUT', { source: 'mine' });
const ds = (await call('dataset'))[1], ctCam = ds.cameras.find(c => c.name === live.name);
assert.equal(ctCam.clips, 2, 'two captures of one stream are one camera with two clips');
assert.ok(ctCam.frames.some(f => f.v) && new Set(ctCam.frames.map(f => f.v)).size === 2, 'frames know their clip');
const ev = ds.events.find(e => e.cameraId === ctCam.id);
assert.ok(ev.vid && ev.vt >= 0, 'events know their clip and clip time');
assert.equal((await fetch(base + `videos/${ev.vid}/frames/${ev.n}`)).headers.get('content-type'), 'image/jpeg');

// archive import: two MEVA clips from one camera become one camera
const small = mv.files.filter(f => f.size < 3e6).slice(0, 1);
const g = mv.files.filter(f => f.camera === small[0].camera);
await call('imports', 'POST', { meva: g.slice(0, 2) });
console.log(`importing ${Math.min(2, g.length)} MEVA clip(s) from camera ${small[0].camera}...`);
await until(async () => (await call('ingest'))[1].imports.every(i => ['done', 'failed'].includes(i.state)));
const imp = (await call('ingest'))[1].imports;
assert.ok(imp.every(i => i.state === 'done'), JSON.stringify(imp.map(i => [i.state, i.error])));
await until(async () => (await ready(`MEVA ${small[0].camera}`)()).length === Math.min(2, g.length));
// search shows one day at a time (latest first), and the archive is from 2018
await call('settings', 'PUT', { day: (await call('dataset'))[1].days.find(d => d.startsWith('2018')) });
const mcam = (await call('dataset'))[1].cameras.find(c => c.name === `MEVA ${small[0].camera}`);
assert.equal(mcam.clips, Math.min(2, g.length)); assert.equal(mcam.tz, sources.MEVA_TZ);
console.log('MEVA camera coverage', mcam.coverage);

srv.close(); indexer.configure({ describe: null });
rmSync(dir, { recursive: true, force: true });
console.log('live sources ok');
process.exit(0);
