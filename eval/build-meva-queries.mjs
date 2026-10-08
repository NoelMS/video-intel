// Builds the MEVA part of eval/queries.json from MEVA's official activity annotations (eval/meva/*.activities.yml,
// CC BY 4.0, Kitware Inc. and IARPA). One plain-English query per activity type; every annotated instance of that type
// on the evaluated cameras is a correct answer (camera + absolute time span).
// usage: node eval/build-meva-queries.mjs   (rewrites the "meva" queries in eval/queries.json, keeps the others)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localToUtc, MEVA_TZ } from '../sources.mjs';

const here = dirname(fileURLToPath(import.meta.url)), FPS = 30;   // MEVA annotations count frames at 30 fps
// How someone would ask for each activity. Types with no natural visual phrasing are left out.
const ASK = {
  person_carries_heavy_object: 'a person carrying a heavy object',
  person_opens_vehicle_door: 'a person opening a car door',
  person_closes_vehicle_door: 'a person closing a car door',
  person_exits_vehicle: 'a person getting out of a car',
  person_texts_on_phone: 'a person texting on a phone',
  person_talks_on_phone: 'a person talking on the phone',
  person_talks_to_person: 'two people talking to each other',
  person_sits_down: 'a person sitting down',
  person_stands_up: 'a person standing up',
  person_opens_facility_door: 'a person opening the door of a building',
  person_enters_scene_through_structure: 'a person coming out of a doorway',
  person_exits_scene_through_structure: 'a person going in through a doorway',
  person_picks_up_object: 'a person picking something up',
  person_puts_down_object: 'a person putting something down',
  person_transfers_object: 'a person handing something to someone',
  person_opens_trunk: 'a person opening the boot of a car',
  person_closes_trunk: 'a person closing the boot of a car',
  person_unloads_vehicle: 'a person unloading a car',
  person_loads_vehicle: 'a person loading a car',
  person_embraces_person: 'two people hugging',
  vehicle_turns_left: 'a car turning left',
  vehicle_turns_right: 'a car turning right',
  vehicle_starts: 'a car starting to drive off',
  vehicle_stops: 'a car coming to a stop',
  vehicle_reverses: 'a car reversing',
  vehicle_makes_u_turn: 'a car making a U-turn',
  vehicle_drops_off_person: 'a car dropping someone off',
};

const answers = {};
for (const f of readdirSync(join(here, 'meva')).filter(f => f.endsWith('.activities.yml'))) {
  const [, date, start, , , camera] = f.match(/^(\d{4}-\d\d-\d\d)\.(\d\d-\d\d-\d\d)\.(\d\d-\d\d-\d\d)\.([\w-]+)\.(G\d+)\./);
  const t0 = Date.parse(localToUtc(date, start.replace(/-/g, ':'), MEVA_TZ));
  for (const line of readFileSync(join(here, 'meva', f), 'utf8').split('\n')) {
    const type = line.match(/'act2': \{'([a-z_]+)'/)?.[1], span = line.match(/'id2': \d+, 'src_status': '\w+', 'timespan': \[\{'tsr0': \[(\d+), (\d+)\]/);
    if (!type || !span || !ASK[type]) continue;
    (answers[type] ||= []).push({ camera: `MEVA ${camera}`, from: new Date(t0 + span[1] / FPS * 1000).toISOString(), to: new Date(t0 + span[2] / FPS * 1000).toISOString() });
  }
}

// Alternate dev / held-out by type name, so tuning on dev never sees a held-out query.
const meva = Object.keys(answers).sort().map((type, i) => ({ id: `meva-${type}`, split: i % 2 ? 'heldout' : 'dev', kind: 'activity', source: 'MEVA annotation', text: `Find ${ASK[type]}`, answers: answers[type] }));
const file = join(here, 'queries.json'), old = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { queries: [] };
const queries = [...old.queries.filter(q => !q.id.startsWith('meva-')), ...meva];
writeFileSync(file, JSON.stringify({ note: 'Held-out evaluation queries. MEVA answers come from the official MEVA annotations (CC BY 4.0, Kitware Inc. and IARPA); attribute queries were labelled by hand from the footage.', queries }, null, 1));
console.log(`${meva.length} MEVA queries (${meva.filter(q => q.split === 'heldout').length} held out), ${meva.reduce((n, q) => n + q.answers.length, 0)} annotated instances; ${queries.length} queries in all`);
