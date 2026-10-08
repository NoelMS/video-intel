# Multi-Stream Video Intelligence: write-up

Problem statement HNX26EPS05: plug in several cameras, index what happens on all of them, and answer plain-English
questions ("did a red car pass through the main gate in the last hour?") with the camera, the time and the visual
evidence. Everything here runs on one laptop (RTX 3050, 4 GB) with no cloud calls.

## What the system does

| Challenge | How it is met |
|---|---|
| Open-vocabulary search | Each tracked object gets a MobileCLIP image embedding and a short fixed-choice description from a local vision model; a query is matched against both, so words outside any label set ("delivery box", "large bag") still work through the image embedding. |
| Grounded answers | Every answer is a camera + timestamp + frame, with a downloadable clip (`/api/videos/:id/clip`) and the checks that passed or failed. Unsupported questions are refused rather than guessed. |
| Clarify once, then remember | An unknown place ("the main gate") triggers one question: pick the camera, drag over the area. The referent is stored on the server and used for every later query, also after a restart (verified end to end, below). |
| Cross-camera continuity | Objects on different cameras are linked as *possible* sightings of one entity only when their crops look alike (MobileCLIP cosine >= 0.88, mutual best match), share a colour and are close in time; journeys are reconstructed from those links. |

## Pipeline

1. **Ingest.** Uploads (with an optional `manifest.csv` of camera names and start times), public live cameras (TfL,
   Caltrans, any HLS/RTSP URL, periodic or continuous), and archive imports (MEVA). ffmpeg makes an H.264 copy when the
   browser cannot play the source.
2. **Detect and track.** Frames are sampled at 5 fps. YOLOX-S (ONNX Runtime, DirectML) finds people, vehicles,
   animals and bags in each frame (~0.1 s a frame). A SORT-style tracker links them: constant-velocity prediction,
   global best-pair matching, a size check. Association F1 against 25 fps reference identities: 0.90, up from 0.70
   for the earlier greedy linker at 2 fps.
3. **Describe once per track.** The local vision model (qwen3-vl:2b via Ollama) names each track once from crops of
   its largest sighting, two crops per call, choosing from fixed lists (colour, body type, clothing colours, what is
   carried). Fixed lists cut answer length from ~880 to ~17 tokens and make labels match the words people search with.
4. **Embed.** MobileCLIP-S0 embeds each track's best crop, plus one whole frame per second.
5. **Search.** A query is parsed into entity, attributes, place (a remembered referent or a clarifying question) and
   time window ("in the last hour", "between 9 and 9:30", "after 9:40"). Candidates are ranked by a blend of the
   object-crop similarity (as a percentile among the candidates) and the share of the query's attribute words in the
   label. Each candidate's moment is the second, while it is on screen, whose frame best matches the query. Finally
   the vision model looks at the top candidates' frames with the question and rejects the ones it says "no" to.

## Baseline

The comparison is the standard open-vocabulary retrieval the problem statement names: MobileCLIP frame embeddings at
1 frame per second for every camera, the query embedded as text (question words, times and place names removed), and
frames ranked by cosine similarity. Answer = camera and time of the best frames. It uses the same model, footage and
query parsing as our pipeline, but no detection, tracking, labels, memory or verification
(`baseline.mjs`, `POST /api/baseline/search`).

## Evaluation

**Footage.** 13 cameras on two days:

- **MEVA:** eight cameras, 7 March 2018, 11:00-11:05, at a school site and a bus site. 40 minutes of 1080p footage,
  imported from the public MEVA bucket.
- **TfL JamCams:** five London traffic cameras, about 10 s each.

**Queries.** 43 in all, with known answers. A query searches every camera of its day, and must return the right camera
and a time inside the answer span.

- **27 activity queries** come from MEVA's official human annotations (CC BY 4.0, Kitware and IARPA): one plain-English
  query per activity type ("Find a person getting out of a car"), with every annotated instance on the 8 cameras as a
  correct answer.
- **16 attribute queries** were labelled by hand from timestamped contact sheets of the raw footage, not from this
  system's output: "Find the red double-decker bus", "Find the person in a red jacket"...

Queries alternate between a development split (22, used for tuning) and a held-out split (21).

**Protocol.**

- **Hit:** right camera and a time within the answer span +-5 s, half of the 10 s clip handed to the user ("strict": +-2 s).
- **Hit@k:** a hit within the top k results. **MRR:** mean reciprocal rank of the first hit in the top 10.
- **Latency:** the full HTTP round trip of a search, as the app makes it.
- **Reproduce:** `node eval/eval.mjs --base <server> --split heldout|dev|all`.

### Results: all 43 queries (`eval/results-all.md`)

| Method | Hit@1 | Hit@5 | MRR | Strict Hit@1 | Right camera @1 | Median time error @1 | Median latency |
|---|---|---|---|---|---|---|---|
| Baseline: CLIP frame retrieval | 30.2% | 46.5% | 0.363 | 25.6% | 55.8% | 3.5 s | 11 ms |
| Ours: detector + tracks + label words | 25.6% | 37.2% | 0.322 | 23.3% | 69.8% | 12.7 s | 93 ms |
| + object-crop CLIP | 25.6% | 62.8% | 0.414 | 23.3% | 51.2% | 3.8 s | 91 ms |
| + label words with it (hybrid) | 30.2% | 65.1% | 0.444 | 27.9% | 53.5% | 1.5 s | 92 ms |
| + moment per object from frames | 32.6% | 69.8% | 0.464 | 32.6% | 53.5% | 0.0 s | 91 ms |
| **+ vision-model verification (full)** | **41.9%** | **72.1%** | **0.528** | **39.5%** | **65.1%** | **0.3 s** | 4.9 s |

By kind:

| Queries | Method | Hit@1 | Hit@5 | MRR |
|---|---|---|---|---|
| 27 activity (official annotations) | Baseline | 11.1% | 29.6% | 0.183 |
| | Ours (full) | **33.3%** | **70.4%** | **0.452** |
| 16 attribute (hand labels) | Baseline | **62.5%** | 75.0% | **0.667** |
| | Ours (full) | 56.3% | 75.0% | 0.656 |

### Held-out split

| Run | Method | Hit@1 | Hit@5 | MRR |
|---|---|---|---|---|
| First run (`results-heldout-v1.md`) | Baseline | 23.8% | 42.9% | 0.317 |
| | Ours (full) | 23.8% | 66.7% | 0.384 |
| Final code (`results-heldout.md`) | Baseline | 23.8% | 42.9% | 0.317 |
| | Ours (full) | **28.6%** | **71.4%** | **0.432** |

**Disclosure.** The first held-out run showed our pipeline returning nothing for "the person in a red jacket". The
cause was a bug: the demo dataset's attribute vocabulary leaked into real footage, so "jacket" became a required word
that no real label contains. The fix (on real footage, attribute words are only those that occur in its labels) is
general, but because it was found on held-out output, the final held-out numbers are not a clean first look. Both runs
are reported. Weights were tuned on the development split only: the frame signal is used for the moment and not for
ranking, because ranking by it lowered development Hit@5 from 0.64 to 0.41.

### What the ablation shows

- **Tracking + object crops** is the big step for finding the right *thing*: Hit@5 rises from 46.5% (baseline) to
  62.8%. The baseline sees whole frames, where a person getting out of a car is a small part of a busy picture.
- **Label words** add precision on colours and kinds (Hit@1 +4.6 points).
- **Per-object moments** fix *when*: the object's best-matching second, not its largest sighting, takes the median time
  error at rank 1 to 0 s.
- **Verification** by the vision model is the largest Hit@1 gain (+9.3 points) at a cost of ~5 s per query. The app's
  Fast depth skips it.
- **Where it does not help:** for simple appearance queries ("red double-decker bus", "white SUV") whole-frame
  retrieval is already strong and slightly better at Hit@1. Our gains are on activities and moments, which is where
  CCTV questions are hard.

### Latency

The baseline answers in ~11 ms (one text embedding and a dot product per indexed second). Ours answers in ~90 ms
without verification and ~5 s with the vision model's check of up to 6 candidates (the evaluation runs at Deep depth).
In the app, Fast depth skips the check, Balanced checks the top 3 and Deep the top 6. Indexing is the slow part: 5 fps detection plus naming runs at roughly 2.5-4x real time
on busy footage on this 4 GB GPU.

## Clarify once, then remember

Verified end to end in a real browser against a running server (headless Chrome):

1. "Did a white van pass through the main gate?" asks once which camera and area "the main gate" is.
2. After it is drawn, the search answers.
3. After a full server restart, the same question and a different one ("Was anyone at the main gate after 15:00?")
   are answered without asking again.

Referents persist in the server's store with aliases; `check.mjs` also asserts persistence across a restart.

## Cross-camera continuity

Journeys chain sightings that the linker accepts. A first version linked whenever crops had cosine >= 0.8: 206 links
on the evaluation footage, many plainly wrong, because small, blurry crops of vehicles all look alike to CLIP. The
final rule (cosine >= 0.88, both objects at least 40x40 px in frame space, a shared colour word, mutual best match,
within 15 minutes) links rarely: 1 pair on the evaluation footage. Links are always presented as *possible*. Measuring
re-identification accuracy needs cross-camera identity labels, which our evaluation set does not have; this is the main
open item.

## Bonus items

- **Live ingestion:** about 890 London (TfL) cameras and California (Caltrans) cameras in all 12 districts, or any HLS/RTSP URL. Each camera is captured
  periodically or continuously (ffmpeg segments, queued as they close); while indexing is behind, segments are
  dropped and shown as coverage gaps.
- **Standing queries / alerts:** checked against every recording as it finishes indexing (uploads, live captures,
  imports).
- **Privacy:** on-premises only (no network calls during analysis). Face and plate masks are generous approximations
  from person and vehicle boxes (there is no face/plate detector). Retention limits, operator roles, and an audit
  trail for every reveal.

## Limitations

- Small evaluation set (43 queries, 13 cameras, two locations); confidence intervals are wide.
- Attribute queries were labelled by one person from 10 s (MEVA) or 0.5 s (TfL) contact sheets, with spans widened
  ~5 s for MEVA.
- The baseline uses our own query parsing (phrase extraction), which helps it; a raw-question baseline would score lower.
- Re-identification precision and recall are not measured (no identity labels).
- Indexing runs slower than real time on a 4 GB GPU.

## Reproduce

```
node check.mjs                                   # offline checks (pipeline, memory across restart, tracker, alerts)
# index the evaluation footage: Cameras -> Import an archive -> MEVA, 2018-03-07 / 11 / the eight cameras above,
# plus the TfL clips; then
node eval/build-meva-queries.mjs && node eval/hand-labels.mjs
node eval/eval.mjs --base http://127.0.0.1:8000 --split heldout
```
