# Tracking identity against MEVA per-frame boxes

People boxed by MEVA (activity actors only), sampled at our 5 fps frames. Detected: one of our boxes overlaps (IoU >= 0.5). Identity recall/precision: frames where the person's one assigned track is the one found, over all / over detected frames.

| Camera | People found (of boxed) | Person-frames | Detected | Identity recall | Identity precision | Our tracks per person |
|---|---|---|---|---|---|---|
| MEVA G508 | 15 of 15 | 525 | 64.6% | 52.4% | 81.1% | 1.20 |
| MEVA G420 | 15 of 16 | 788 | 90.9% | 63.3% | 69.7% | 1.20 |
| MEVA G505 | 28 of 28 | 1466 | 89.0% | 57.6% | 64.8% | 1.82 |
| MEVA G506 | 69 of 97 | 9515 | 37.2% | 15.0% | 40.2% | 1.64 |
| MEVA G509 | 4 of 10 | 201 | 10.0% | 8.0% | 80.0% | 1.00 |
| MEVA G328 | 0 of 42 | 6664 | 0.0% | 0.0% | 0.0% | 0.00 |
| MEVA G419 | 13 of 13 | 792 | 74.1% | 55.9% | 75.5% | 1.23 |
| MEVA G339 | 3 of 113 | 17541 | 2.4% | 1.7% | 71.4% | 3.00 |
| All | 147 of 334 | 37492 | 18.5% | 10.2% | 54.9% | 1.56 |
