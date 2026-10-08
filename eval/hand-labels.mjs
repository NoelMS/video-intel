// Attribute queries labelled by hand from timestamped contact sheets of the raw footage (not from this system's
// output). Spans are seconds into each camera's clip; a clip's start is its wall-clock start. Merged into
// eval/queries.json as "attr-*" queries (dev / held-out alternate).
// usage: node eval/hand-labels.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// camera name (as indexed) -> wall-clock start of its clip
const START = {
  'Oxford St/Orchard St': '2026-10-08T14:09:00Z', 'Piccadilly Circus': '2026-10-08T14:08:00Z', 'Tower Bridge App./East Smithfield': '2026-10-08T14:05:00Z',
  'Blackfriars Rd/St George': '2026-10-08T14:06:00Z', 'Strand/Lancaster Place': '2026-10-08T14:09:00Z',
  // MEVA clips 2018-03-07 11:00 local, Indianapolis (EST, UTC-5; DST began 11 March): start from each file name
  'MEVA G508': '2018-03-07T16:00:00Z', 'MEVA G420': '2018-03-07T16:00:00Z', 'MEVA G505': '2018-03-07T16:00:01Z', 'MEVA G506': '2018-03-07T16:00:01Z',
  'MEVA G509': '2018-03-07T16:00:01Z', 'MEVA G328': '2018-03-07T16:00:01Z', 'MEVA G419': '2018-03-07T16:00:01Z', 'MEVA G339': '2018-03-07T16:00:07Z',
};
// [query, [camera, from s, to s], ...]
const LABELS = [
  ['Find the red double-decker bus', ['Blackfriars Rd/St George', 5.5, 9.5], ['Piccadilly Circus', 0, 2], ['Oxford St/Orchard St', 0, 8.5]],
  ['Find a London taxi', ['Piccadilly Circus', 0, 3.5], ['Oxford St/Orchard St', 0, 3.5], ['Blackfriars Rd/St George', 2.5, 4.5]],
  ['Find the motorcycle courier with a delivery box', ['Blackfriars Rd/St George', 1, 2.5]],
  ['Find the red car', ['Tower Bridge App./East Smithfield', 2.5, 4.5]],
  ['Find the white box truck', ['Tower Bridge App./East Smithfield', 3.5, 9.5]],
  ['Find the white flatbed truck with yellow chevrons', ['Piccadilly Circus', 1.5, 9.5]],
  ['Find the cyclist', ['Piccadilly Circus', 0, 3], ['Oxford St/Orchard St', 0, 8.5]],
  ['Find the scooter rider in a white helmet', ['Piccadilly Circus', 0.5, 2]],
  ['Find the blue car', ['Tower Bridge App./East Smithfield', 2, 5], ['Blackfriars Rd/St George', 2.5, 4.5]],
  ['Find the white SUV', ['Tower Bridge App./East Smithfield', 1, 4]],
  ['Find the dark coach', ['Tower Bridge App./East Smithfield', 7, 9.5]],
  // MEVA (sheets every 10 s, spans widened ~5 s)
  ['Find the person in a red jacket', ['MEVA G506', 120, 285], ['MEVA G505', 130, 170], ['MEVA G505', 210, 235], ['MEVA G505', 240, 280]],
  ['Find a person sitting on a bench', ['MEVA G508', 0, 45], ['MEVA G506', 55, 300]],
  ['Find the group of people walking across the car park', ['MEVA G505', 175, 215]],
  ['Find the person carrying a white bag', ['MEVA G419', 125, 135]],
  // was "...in the car park": car park is now a place word, so that query (rightly) asks where the car park is first
  ['Find a parked red car', ['MEVA G339', 0, 300], ['MEVA G328', 0, 300], ['MEVA G505', 228, 245]],
];

const at = (cam, s) => new Date(Date.parse(START[cam]) + s * 1000).toISOString();
const attr = LABELS.map(([text, ...spans], i) => ({
  id: 'attr-' + text.toLowerCase().replace(/^find (the |a |an )?/, '').replace(/[^a-z]+/g, '-'), split: i % 2 ? 'heldout' : 'dev', kind: 'attribute', source: 'hand-labelled',
  text, answers: spans.map(([camera, from, to]) => { if (!START[camera]) throw new Error(`no start for ${camera}`); return { camera, from: at(camera, from), to: at(camera, to) }; }),
}));
const file = join(here, 'queries.json'), old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { queries: [] };
writeFileSync(file, JSON.stringify({ ...old, queries: [...old.queries.filter(q => !q.id.startsWith('attr-')), ...attr] }, null, 1));
console.log(`${attr.length} hand-labelled attribute queries (${attr.filter(q => q.split === 'heldout').length} held out)`);
