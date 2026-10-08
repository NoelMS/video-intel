# Evaluation: all split, 43 queries (27 activity, 16 attribute)

Hit = right camera and a time within the answer span +-5 s (strict: +-2 s). Footage: 13 cameras over 2 day(s), 13 recordings. Each query searches all cameras of its day.

| Method | Hit@1 | Hit@5 | MRR | Strict Hit@1 | Right camera @1 | Median time error @1 (s) | Median latency (ms) | p90 latency (ms) |
|---|---|---|---|---|---|---|---|---|
| Baseline: CLIP frame retrieval (1 frame/s) | 30.2% | 46.5% | 0.363 | 25.6% | 55.8% | 3.5 | 27 | 31 |
| Ours: detector + tracks + label words | 25.6% | 39.5% | 0.334 | 23.3% | 69.8% | 12.7 | 93 | 109 |
| Ours: detector + tracks + object-crop CLIP | 27.9% | 65.1% | 0.441 | 25.6% | 53.5% | 3.8 | 93 | 108 |
| Ours: + label words (objects + labels) | 32.6% | 67.4% | 0.471 | 30.2% | 55.8% | 1.2 | 93 | 123 |
| Ours: + frame context and moment per object | 32.6% | 72.1% | 0.478 | 32.6% | 55.8% | 0.0 | 94 | 111 |
| Ours: + vision-model verification (full) | 41.9% | 76.7% | 0.544 | 39.5% | 67.4% | 0.5 | 5670 | 13202 |

<details><summary>Per query (rank of the first hit, -1 = none in the top 10; top result)</summary>

| Query | baseline | labels | objects | hybrid | moments | verified |
|---|---|---|---|---|---|---|
| Find a person carrying a heavy object | 0 (MEVA G419 16:02:15) | -1 (MEVA G508 16:00:00) | 2 (MEVA G506 16:01:55) | 2 (MEVA G506 16:01:55) | 4 (MEVA G506 16:01:54) | 4 (MEVA G506 16:01:54) |
| Find a person closing the boot of a car | -1 (MEVA G339 16:00:36) | -1 (MEVA G506 16:01:11) | -1 (MEVA G328 16:04:48) | -1 (MEVA G328 16:04:48) | -1 (MEVA G328 16:03:47) | -1 (MEVA G506 16:00:49) |
| Find a person closing a car door | -1 (MEVA G505 16:03:05) | 6 (MEVA G506 16:01:11) | 5 (MEVA G505 16:02:10) | 5 (MEVA G505 16:02:10) | 5 (MEVA G505 16:02:13) | 0 (MEVA G506 16:00:49) |
| Find two people hugging | -1 (MEVA G419 16:00:39) | -1 (MEVA G508 16:00:00) | 1 (MEVA G506 16:03:38) | 1 (MEVA G506 16:03:38) | 1 (MEVA G506 16:03:38) | 2 (MEVA G506 16:04:33) |
| Find a person coming out of a doorway | 8 (MEVA G419 16:02:08) | 0 (MEVA G508 16:00:00) | 0 (MEVA G506 16:05:00) | 0 (MEVA G506 16:05:00) | 0 (MEVA G506 16:05:00) | 0 (MEVA G506 16:05:00) |
| Find a person going in through a doorway | 0 (MEVA G419 16:02:15) | 1 (MEVA G508 16:00:00) | 1 (MEVA G506 16:05:00) | 1 (MEVA G506 16:05:00) | 1 (MEVA G506 16:05:00) | 1 (MEVA G506 16:05:00) |
| Find a person getting out of a car | -1 (MEVA G339 16:00:39) | 6 (MEVA G506 16:01:11) | 2 (MEVA G506 16:01:40) | 2 (MEVA G506 16:01:40) | 2 (MEVA G506 16:01:47) | 2 (MEVA G506 16:01:47) |
| Find a person loading a car | -1 (MEVA G505 16:03:58) | -1 (MEVA G506 16:01:11) | -1 (MEVA G328 16:04:48) | -1 (MEVA G328 16:04:48) | -1 (MEVA G328 16:03:15) | -1 (MEVA G506 16:01:39) |
| Find a person opening the door of a building | -1 (MEVA G419 16:00:28) | -1 (-) | -1 (-) | -1 (-) | -1 (-) | -1 (-) |
| Find a person opening the boot of a car | -1 (MEVA G505 16:03:05) | -1 (MEVA G506 16:01:11) | 1 (MEVA G328 16:04:48) | 1 (MEVA G328 16:04:48) | 1 (MEVA G328 16:03:04) | 0 (MEVA G506 16:00:49) |
| Find a person opening a car door | -1 (MEVA G505 16:03:05) | 6 (MEVA G506 16:01:11) | -1 (MEVA G505 16:01:54) | -1 (MEVA G505 16:01:54) | 2 (MEVA G505 16:01:57) | 0 (MEVA G339 16:00:36) |
| Find a person picking something up | -1 (MEVA G419 16:00:28) | 5 (MEVA G508 16:00:00) | 1 (MEVA G506 16:00:23) | 1 (MEVA G506 16:00:23) | -1 (MEVA G506 16:00:48) | -1 (MEVA G506 16:00:48) |
| Find a person putting something down | -1 (MEVA G420 16:01:26) | -1 (MEVA G508 16:00:00) | -1 (MEVA G505 16:02:38) | -1 (MEVA G505 16:02:38) | 2 (MEVA G505 16:02:37) | 2 (MEVA G505 16:02:37) |
| Find a person sitting down | -1 (MEVA G419 16:02:08) | -1 (MEVA G508 16:00:00) | 4 (MEVA G506 16:01:11) | 4 (MEVA G506 16:01:11) | 4 (MEVA G506 16:01:12) | 3 (MEVA G506 16:01:12) |
| Find a person standing up | -1 (MEVA G419 16:00:28) | 2 (MEVA G508 16:00:00) | 7 (MEVA G339 16:02:56) | 7 (MEVA G339 16:02:56) | 7 (MEVA G339 16:02:58) | 7 (MEVA G339 16:02:58) |
| Find a person talking on the phone | 1 (MEVA G419 16:00:26) | -1 (MEVA G420 16:01:56) | -1 (MEVA G506 16:01:11) | -1 (MEVA G506 16:03:41) | 4 (MEVA G506 16:03:53) | 4 (MEVA G506 16:03:53) |
| Find two people talking to each other | 0 (MEVA G419 16:01:18) | 2 (MEVA G508 16:00:00) | 0 (MEVA G506 16:04:50) | 0 (MEVA G506 16:04:50) | 0 (MEVA G506 16:04:53) | 0 (MEVA G506 16:04:53) |
| Find a person texting on a phone | 4 (MEVA G505 16:03:05) | 0 (MEVA G420 16:01:56) | 2 (MEVA G506 16:01:11) | 0 (MEVA G506 16:03:41) | 0 (MEVA G506 16:03:56) | 0 (MEVA G506 16:03:56) |
| Find a person handing something to someone | 3 (MEVA G505 16:03:05) | -1 (MEVA G508 16:00:00) | 0 (MEVA G505 16:02:38) | 0 (MEVA G505 16:02:38) | 0 (MEVA G505 16:02:38) | 0 (MEVA G505 16:02:38) |
| Find a person unloading a car | -1 (MEVA G505 16:02:17) | -1 (MEVA G506 16:01:11) | 4 (MEVA G328 16:04:48) | 4 (MEVA G328 16:04:48) | 4 (MEVA G328 16:03:15) | 2 (MEVA G506 16:01:39) |
| Find a car dropping someone off | -1 (MEVA G339 16:03:49) | -1 (MEVA G506 16:01:11) | -1 (MEVA G506 16:00:41) | -1 (MEVA G506 16:00:41) | -1 (MEVA G506 16:00:24) | -1 (MEVA G506 16:00:24) |
| Find a car making a U-turn | -1 (MEVA G328 16:03:04) | -1 (MEVA G506 16:01:11) | -1 (MEVA G328 16:02:32) | -1 (MEVA G328 16:02:32) | -1 (MEVA G328 16:02:33) | -1 (MEVA G328 16:02:33) |
| Find a car reversing | -1 (MEVA G328 16:01:19) | 0 (MEVA G506 16:01:11) | 1 (MEVA G506 16:04:46) | 1 (MEVA G506 16:04:46) | 1 (MEVA G506 16:04:47) | 0 (MEVA G506 16:01:13) |
| Find a car starting to drive off | 6 (MEVA G328 16:03:09) | 6 (MEVA G506 16:01:11) | 3 (MEVA G505 16:02:10) | 3 (MEVA G505 16:02:10) | 3 (MEVA G505 16:02:12) | 3 (MEVA G505 16:02:12) |
| Find a car coming to a stop | 2 (MEVA G505 16:03:04) | 6 (MEVA G506 16:01:11) | 6 (MEVA G506 16:01:09) | 6 (MEVA G506 16:01:09) | 6 (MEVA G506 16:01:13) | 6 (MEVA G506 16:01:13) |
| Find a car turning left | 6 (MEVA G328 16:03:09) | 1 (MEVA G506 16:01:11) | 3 (MEVA G505 16:02:10) | 3 (MEVA G505 16:02:10) | 4 (MEVA G505 16:02:08) | 4 (MEVA G505 16:02:08) |
| Find a car turning right | 3 (MEVA G339 16:03:29) | -1 (MEVA G506 16:01:11) | 0 (MEVA G505 16:02:10) | 0 (MEVA G505 16:02:10) | 0 (MEVA G505 16:02:08) | 0 (MEVA G505 16:02:08) |
| Find the red double-decker bus | 0 (Blackfriars Rd/St George 14:06:09) | 0 (Blackfriars Rd/St George 14:06:07) | 0 (Blackfriars Rd/St George 14:06:07) | 0 (Blackfriars Rd/St George 14:06:07) | 0 (Blackfriars Rd/St George 14:06:09) | 0 (Blackfriars Rd/St George 14:06:09) |
| Find a London taxi | 0 (Blackfriars Rd/St George 14:06:08) | -1 (Tower Bridge App./East Smithfield 14:05:01) | 1 (Piccadilly Circus 14:08:10) | 1 (Piccadilly Circus 14:08:10) | 1 (Piccadilly Circus 14:08:10) | 1 (Piccadilly Circus 14:08:10) |
| Find the motorcycle courier with a delivery box | 0 (Blackfriars Rd/St George 14:06:02) | 0 (Blackfriars Rd/St George 14:06:01) | 0 (Blackfriars Rd/St George 14:06:01) | 0 (Blackfriars Rd/St George 14:06:01) | 0 (Blackfriars Rd/St George 14:06:02) | 0 (Blackfriars Rd/St George 14:06:02) |
| Find the red car | -1 (Blackfriars Rd/St George 14:06:09) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 1 (Oxford St/Orchard St 14:09:00) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 0 (Tower Bridge App./East Smithfield 14:05:03) |
| Find the white box truck | 0 (Tower Bridge App./East Smithfield 14:05:05) | 0 (Tower Bridge App./East Smithfield 14:05:07) | 0 (Tower Bridge App./East Smithfield 14:05:02) | 0 (Tower Bridge App./East Smithfield 14:05:02) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 0 (Tower Bridge App./East Smithfield 14:05:03) |
| Find the white flatbed truck with yellow chevrons | 2 (Tower Bridge App./East Smithfield 14:05:06) | 9 (Tower Bridge App./East Smithfield 14:05:07) | 0 (Piccadilly Circus 14:08:03) | 0 (Piccadilly Circus 14:08:03) | 0 (Piccadilly Circus 14:08:06) | 0 (Piccadilly Circus 14:08:06) |
| Find the cyclist | 0 (Piccadilly Circus 14:08:08) | -1 (Tower Bridge App./East Smithfield 14:05:01) | 0 (Piccadilly Circus 14:08:00) | 0 (Piccadilly Circus 14:08:00) | 0 (Piccadilly Circus 14:08:01) | 0 (Piccadilly Circus 14:08:01) |
| Find the scooter rider in a white helmet | -1 (Blackfriars Rd/St George 14:06:02) | -1 (Tower Bridge App./East Smithfield 14:05:01) | 7 (Tower Bridge App./East Smithfield 14:05:00) | 3 (Tower Bridge App./East Smithfield 14:05:01) | 3 (Tower Bridge App./East Smithfield 14:05:07) | 1 (Tower Bridge App./East Smithfield 14:05:07) |
| Find the blue car | 0 (Blackfriars Rd/St George 14:06:04) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 1 (Oxford St/Orchard St 14:09:02) | 1 (Oxford St/Orchard St 14:09:02) | 1 (Oxford St/Orchard St 14:09:02) | 1 (Oxford St/Orchard St 14:09:02) |
| Find the white SUV | 0 (Tower Bridge App./East Smithfield 14:05:03) | 0 (Tower Bridge App./East Smithfield 14:05:07) | 1 (Piccadilly Circus 14:08:07) | 1 (Piccadilly Circus 14:08:07) | 1 (Piccadilly Circus 14:08:08) | 1 (Piccadilly Circus 14:08:08) |
| Find the dark coach | -1 (Blackfriars Rd/St George 14:06:08) | 1 (Tower Bridge App./East Smithfield 14:05:01) | -1 (Blackfriars Rd/St George 14:06:01) | -1 (Blackfriars Rd/St George 14:06:01) | 7 (Blackfriars Rd/St George 14:06:02) | 4 (Blackfriars Rd/St George 14:06:00) |
| Find the person in a red jacket | 0 (MEVA G505 16:03:32) | 0 (MEVA G506 16:02:37) | 0 (MEVA G505 16:03:36) | 0 (MEVA G505 16:03:36) | 0 (MEVA G505 16:03:32) | 0 (MEVA G505 16:03:32) |
| Find a person sitting on a bench | -1 (MEVA G505 16:03:12) | 0 (MEVA G508 16:00:00) | 0 (MEVA G508 16:00:00) | 0 (MEVA G508 16:00:00) | 0 (MEVA G508 16:00:09) | 0 (MEVA G508 16:00:09) |
| Find the group of people walking across the car park | 2 (MEVA G505 16:03:48) | -1 (-) | -1 (-) | -1 (-) | -1 (-) | -1 (-) |
| Find the person carrying a white bag | 0 (MEVA G419 16:02:15) | -1 (MEVA G419 16:00:23) | -1 (MEVA G505 16:01:35) | -1 (MEVA G339 16:01:41) | -1 (MEVA G339 16:01:44) | -1 (MEVA G339 16:01:44) |
| Find a parked red car | 0 (MEVA G339 16:03:12) | 4 (MEVA G506 16:04:59) | 0 (MEVA G505 16:04:07) | 0 (MEVA G505 16:04:07) | 0 (MEVA G505 16:04:01) | 0 (MEVA G505 16:04:01) |

</details>
