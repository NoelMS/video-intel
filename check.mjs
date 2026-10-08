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

console.log('all flows ok');
