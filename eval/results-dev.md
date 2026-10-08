# Evaluation: dev split, 22 queries (14 activity, 8 attribute)

Hit = right camera and a time within the answer span +-5 s (strict: +-2 s). Footage: 13 cameras over 2 day(s), 13 recordings. Each query searches all cameras of its day.

| Method | Hit@1 | Hit@5 | MRR | Strict Hit@1 | Right camera @1 | Median time error @1 (s) | Median latency (ms) | p90 latency (ms) |
|---|---|---|---|---|---|---|---|---|
| Baseline: CLIP frame retrieval (1 frame/s) | 36.4% | 50.0% | 0.407 | 31.8% | 59.1% | 0.0 | 25 | 28 |
| Ours: detector + tracks + label words | 31.8% | 40.9% | 0.374 | 31.8% | 77.3% | 7.7 | 93 | 111 |
| Ours: detector + tracks + object-crop CLIP | 36.4% | 59.1% | 0.474 | 31.8% | 63.6% | 1.5 | 93 | 109 |
| Ours: + label words (objects + labels) | 36.4% | 59.1% | 0.474 | 31.8% | 63.6% | 1.5 | 80 | 110 |
| Ours: + frame context and moment per object | 40.9% | 68.2% | 0.529 | 40.9% | 63.6% | 0.0 | 79 | 110 |
| Ours: + vision-model verification (full) | 54.5% | 72.7% | 0.620 | 50.0% | 72.7% | 0.3 | 4456 | 7818 |

<details><summary>Per query (rank of the first hit, -1 = none in the top 10; top result)</summary>

| Query | baseline | labels | objects | hybrid | moments | verified |
|---|---|---|---|---|---|---|
| Find a person carrying a heavy object | 0 (MEVA G419 16:02:15) | -1 (MEVA G508 16:00:00) | 2 (MEVA G506 16:01:55) | 2 (MEVA G506 16:01:55) | 4 (MEVA G506 16:01:54) | 4 (MEVA G506 16:01:54) |
| Find a person closing a car door | -1 (MEVA G505 16:03:05) | 6 (MEVA G506 16:01:11) | 5 (MEVA G505 16:02:10) | 5 (MEVA G505 16:02:10) | 5 (MEVA G505 16:02:13) | 0 (MEVA G506 16:00:49) |
| Find a person coming out of a doorway | 8 (MEVA G419 16:02:08) | 0 (MEVA G508 16:00:00) | 0 (MEVA G506 16:05:00) | 0 (MEVA G506 16:05:00) | 0 (MEVA G506 16:05:00) | 0 (MEVA G506 16:05:00) |
| Find a person getting out of a car | -1 (MEVA G339 16:00:39) | 6 (MEVA G506 16:01:11) | 2 (MEVA G506 16:01:40) | 2 (MEVA G506 16:01:40) | 2 (MEVA G506 16:01:47) | 2 (MEVA G506 16:01:47) |
| Find a person opening the door of a building | -1 (MEVA G419 16:00:28) | -1 (-) | -1 (-) | -1 (-) | -1 (-) | -1 (-) |
| Find a person opening a car door | -1 (MEVA G505 16:03:05) | 6 (MEVA G506 16:01:11) | -1 (MEVA G505 16:01:54) | -1 (MEVA G505 16:01:54) | 2 (MEVA G505 16:01:57) | 0 (MEVA G339 16:00:36) |
| Find a person putting something down | -1 (MEVA G420 16:01:26) | -1 (MEVA G508 16:00:00) | -1 (MEVA G505 16:02:38) | -1 (MEVA G505 16:02:38) | 2 (MEVA G505 16:02:37) | 2 (MEVA G505 16:02:37) |
| Find a person standing up | -1 (MEVA G419 16:00:28) | 2 (MEVA G508 16:00:00) | 7 (MEVA G339 16:02:56) | 7 (MEVA G339 16:02:56) | 7 (MEVA G339 16:02:58) | 7 (MEVA G339 16:02:58) |
| Find two people talking to each other | 0 (MEVA G419 16:01:18) | 2 (MEVA G508 16:00:00) | 0 (MEVA G506 16:04:50) | 0 (MEVA G506 16:04:50) | 0 (MEVA G506 16:04:53) | 0 (MEVA G506 16:04:53) |
| Find a person handing something to someone | 3 (MEVA G505 16:03:05) | -1 (MEVA G508 16:00:00) | 0 (MEVA G505 16:02:38) | 0 (MEVA G505 16:02:38) | 0 (MEVA G505 16:02:38) | 0 (MEVA G505 16:02:38) |
| Find a car dropping someone off | -1 (MEVA G339 16:03:49) | -1 (MEVA G506 16:01:11) | -1 (MEVA G506 16:00:41) | -1 (MEVA G506 16:00:41) | -1 (MEVA G506 16:00:24) | -1 (MEVA G506 16:00:24) |
| Find a car reversing | -1 (MEVA G328 16:01:19) | 0 (MEVA G506 16:01:11) | 1 (MEVA G506 16:04:46) | 1 (MEVA G506 16:04:46) | 1 (MEVA G506 16:04:47) | 0 (MEVA G506 16:01:13) |
| Find a car coming to a stop | 2 (MEVA G505 16:03:04) | 6 (MEVA G506 16:01:11) | 6 (MEVA G506 16:01:09) | 6 (MEVA G506 16:01:09) | 6 (MEVA G506 16:01:13) | 6 (MEVA G506 16:01:13) |
| Find a car turning right | 3 (MEVA G339 16:03:29) | -1 (MEVA G506 16:01:11) | 0 (MEVA G505 16:02:10) | 0 (MEVA G505 16:02:10) | 0 (MEVA G505 16:02:08) | 0 (MEVA G505 16:02:08) |
| Find the red double-decker bus | 0 (Blackfriars Rd/St George 14:06:09) | 0 (Blackfriars Rd/St George 14:06:07) | 0 (Blackfriars Rd/St George 14:06:07) | 0 (Blackfriars Rd/St George 14:06:07) | 0 (Blackfriars Rd/St George 14:06:09) | 0 (Blackfriars Rd/St George 14:06:09) |
| Find the motorcycle courier with a delivery box | 0 (Blackfriars Rd/St George 14:06:02) | 0 (Blackfriars Rd/St George 14:06:01) | 0 (Blackfriars Rd/St George 14:06:01) | 0 (Blackfriars Rd/St George 14:06:01) | 0 (Blackfriars Rd/St George 14:06:02) | 0 (Blackfriars Rd/St George 14:06:02) |
| Find the white box truck | 0 (Tower Bridge App./East Smithfield 14:05:05) | 0 (Tower Bridge App./East Smithfield 14:05:07) | 0 (Tower Bridge App./East Smithfield 14:05:02) | 0 (Tower Bridge App./East Smithfield 14:05:02) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 0 (Tower Bridge App./East Smithfield 14:05:03) |
| Find the cyclist | 0 (Piccadilly Circus 14:08:08) | -1 (Tower Bridge App./East Smithfield 14:05:00) | -1 (Tower Bridge App./East Smithfield 14:05:00) | -1 (Tower Bridge App./East Smithfield 14:05:00) | -1 (Tower Bridge App./East Smithfield 14:05:00) | -1 (Tower Bridge App./East Smithfield 14:05:00) |
| Find the blue car | 0 (Blackfriars Rd/St George 14:06:04) | 0 (Tower Bridge App./East Smithfield 14:05:03) | 1 (Oxford St/Orchard St 14:09:02) | 1 (Oxford St/Orchard St 14:09:02) | 1 (Oxford St/Orchard St 14:09:02) | 1 (Oxford St/Orchard St 14:09:02) |
| Find the dark coach | -1 (Blackfriars Rd/St George 14:06:08) | -1 (Tower Bridge App./East Smithfield 14:05:00) | 2 (Tower Bridge App./East Smithfield 14:05:00) | 2 (Tower Bridge App./East Smithfield 14:05:00) | 0 (Tower Bridge App./East Smithfield 14:05:07) | 0 (Tower Bridge App./East Smithfield 14:05:07) |
| Find a person sitting on a bench | -1 (MEVA G505 16:03:12) | 0 (MEVA G508 16:00:00) | 0 (MEVA G508 16:00:00) | 0 (MEVA G508 16:00:00) | 0 (MEVA G508 16:00:09) | 0 (MEVA G508 16:00:09) |
| Find the person carrying a white bag | 0 (MEVA G419 16:02:15) | -1 (MEVA G419 16:00:23) | -1 (MEVA G505 16:01:35) | -1 (MEVA G339 16:01:41) | -1 (MEVA G339 16:01:44) | -1 (MEVA G339 16:01:44) |

</details>
