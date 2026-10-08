# Evaluation: heldout split, 21 queries (13 activity, 8 attribute)

Hit = right camera and a time within the answer span +-5 s (strict: +-2 s). Footage: 13 cameras over 2 day(s), 13 recordings. Each query searches all cameras of its day.

| Method | Hit@1 | Hit@5 | MRR | Strict Hit@1 | Right camera @1 | Median time error @1 (s) | Median latency (ms) | p90 latency (ms) |
|---|---|---|---|---|---|---|---|---|
| Baseline: CLIP frame retrieval (1 frame/s) | 23.8% | 42.9% | 0.317 | 19.0% | 52.4% | 12.0 | 11 | 13 |
| Ours: detector + tracks + label words | 19.0% | 33.3% | 0.267 | 14.3% | 61.9% | 14.3 | 78 | 94 |
| Ours: detector + tracks + object-crop CLIP | 14.3% | 71.4% | 0.374 | 14.3% | 42.9% | 5.4 | 93 | 108 |
| Ours: + label words (objects + labels) | 23.8% | 76.2% | 0.436 | 23.8% | 47.6% | 1.2 | 93 | 110 |
| Ours: + frame context and moment per object | 23.8% | 76.2% | 0.419 | 23.8% | 47.6% | 0.0 | 94 | 113 |
| Ours: + vision-model verification (full) | 28.6% | 76.2% | 0.456 | 28.6% | 61.9% | 5.8 | 6025 | 7429 |

<details><summary>Per query (rank of the first hit, -1 = none in the top 10; top result)</summary>

| Query | baseline | labels | objects | hybrid | moments | verified |
|---|---|---|---|---|---|---|
| Find a person closing the boot of a car | -1 (MEVA G339 16:00:36) | -1 (MEVA G506 16:01:11) | -1 (MEVA G328 16:04:48) | -1 (MEVA G328 16:04:48) | -1 (MEVA G328 16:03:47) | -1 (MEVA G506 16:00:49) |
| Find two people hugging | -1 (MEVA G419 16:00:39) | -1 (MEVA G508 16:00:00) | 1 (MEVA G506 16:03:38) | 1 (MEVA G506 16:03:38) | 1 (MEVA G506 16:03:38) | 2 (MEVA G506 16:04:33) |
| Find a person going in through a doorway | 0 (MEVA G419 16:02:15) | 1 (MEVA G508 16:00:00) | 1 (MEVA G506 16:05:00) | 1 (MEVA G506 16:05:00) | 1 (MEVA G506 16:05:00) | 1 (MEVA G506 16:05:00) |
| Find a person loading a car | -1 (MEVA G505 16:03:58) | -1 (MEVA G506 16:01:11) | -1 (MEVA G328 16:04:48) | -1 (MEVA G328 16:04:48) | -1 (MEVA G328 16:03:15) | -1 (MEVA G506 16:01:39) |
| Find a person opening the boot of a car | -1 (MEVA G505 16:03:05) | -1 (MEVA G506 16:01:11) | 1 (MEVA G328 16:04:48) | 1 (MEVA G328 16:04:48) | 1 (MEVA G328 16:03:04) | 0 (MEVA G506 16:00:49) |
| Find a person picking something up | -1 (MEVA G419 16:00:28) | 5 (MEVA G508 16:00:00) | 1 (MEVA G506 16:00:23) | 1 (MEVA G506 16:00:23) | -1 (MEVA G506 16:00:48) | -1 (MEVA G506 16:00:48) |
| Find a person sitting down | -1 (MEVA G419 16:02:08) | -1 (MEVA G508 16:00:00) | 4 (MEVA G506 16:01:11) | 4 (MEVA G506 16:01:11) | 4 (MEVA G506 16:01:12) | 3 (MEVA G506 16:01:12) |
| Find a person talking on the phone | 1 (MEVA G419 16:00:26) | -1 (MEVA G420 16:01:56) | -1 (MEVA G506 16:01:11) | -1 (MEVA G506 16:03:41) | 4 (MEVA G506 16:03:53) | 4 (MEVA G506 16:03:53) |
| Find a person texting on a phone | 4 (MEVA G505 16:03:05) | 0 (MEVA G420 16:01:56) | 2 (MEVA G506 16:01:11) | 0 (MEVA G506 16:03:41) | 0 (MEVA G506 16:03:56) | 0 (MEVA G506 16:03:56) |
| Find a person unloading a car | -1 (MEVA G505 16:02:17) | -1 (MEVA G506 16:01:11) | 4 (MEVA G328 16:04:48) | 4 (MEVA G328 16:04:48) | 4 (MEVA G328 16:03:15) | 2 (MEVA G506 16:01:39) |
| Find a car making a U-turn | -1 (MEVA G328 16:03:04) | -1 (MEVA G506 16:01:11) | -1 (MEVA G328 16:02:32) | -1 (MEVA G328 16:02:32) | -1 (MEVA G328 16:02:33) | -1 (MEVA G328 16:02:33) |
| Find a car starting to drive off | 6 (MEVA G328 16:03:09) | 6 (MEVA G506 16:01:11) | 3 (MEVA G505 16:02:10) | 3 (MEVA G505 16:02:10) | 3 (MEVA G505 16:02:12) | 3 (MEVA G505 16:02:12) |
| Find a car turning left | 6 (MEVA G328 16:03:09) | 1 (MEVA G506 16:01:11) | 3 (MEVA G505 16:02:10) | 3 (MEVA G505 16:02:10) | 4 (MEVA G505 16:02:08) | 4 (MEVA G505 16:02:08) |
| Find a London taxi | 0 (Blackfriars Rd/St George 14:06:08) | -1 (Tower Bridge App./East Smithfield 14:05:01) | 1 (Piccadilly Circus 14:08:10) | 1 (Piccadilly Circus 14:08:10) | 1 (Piccadilly Circus 14:08:10) | 1 (Piccadilly Circus 14:08:10) |
| Find the red car | -1 (Blackfriars Rd/St George 14:06:09) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 1 (Oxford St/Orchard St 14:09:00) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 0 (Tower Bridge App./East Smithfield 14:05:03) |
| Find the white flatbed truck with yellow chevrons | 2 (Tower Bridge App./East Smithfield 14:05:06) | 9 (Tower Bridge App./East Smithfield 14:05:07) | 0 (Piccadilly Circus 14:08:03) | 0 (Piccadilly Circus 14:08:03) | 0 (Piccadilly Circus 14:08:06) | 0 (Piccadilly Circus 14:08:06) |
| Find the scooter rider in a white helmet | -1 (Blackfriars Rd/St George 14:06:02) | -1 (Tower Bridge App./East Smithfield 14:05:01) | 7 (Tower Bridge App./East Smithfield 14:05:00) | 3 (Tower Bridge App./East Smithfield 14:05:01) | 3 (Tower Bridge App./East Smithfield 14:05:07) | 1 (Tower Bridge App./East Smithfield 14:05:07) |
| Find the white SUV | 0 (Tower Bridge App./East Smithfield 14:05:03) | 0 (Tower Bridge App./East Smithfield 14:05:07) | 1 (Piccadilly Circus 14:08:07) | 1 (Piccadilly Circus 14:08:07) | 1 (Piccadilly Circus 14:08:08) | 1 (Piccadilly Circus 14:08:08) |
| Find the person in a red jacket | 0 (MEVA G505 16:03:32) | 0 (MEVA G506 16:02:37) | 0 (MEVA G505 16:03:36) | 0 (MEVA G505 16:03:36) | 0 (MEVA G505 16:03:32) | 0 (MEVA G505 16:03:32) |
| Find the group of people walking across the car park | 2 (MEVA G505 16:03:48) | -1 (-) | -1 (-) | -1 (-) | -1 (-) | -1 (-) |
| Find a parked red car | 0 (MEVA G339 16:03:12) | 4 (MEVA G506 16:04:59) | 0 (MEVA G505 16:04:07) | 0 (MEVA G505 16:04:07) | 0 (MEVA G505 16:04:01) | 0 (MEVA G505 16:04:01) |

</details>
