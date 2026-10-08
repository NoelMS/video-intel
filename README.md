# Multi-Stream Video Intelligence

Ask questions about recorded multi-camera footage in plain English — *"Did a red car pass through the main gate?"* — and get back **which camera, when, and the visual evidence**, with the reasoning shown.

Built for problem statement **HNX26EPS05: Multi-Stream Video Intelligence with Conversational Query**. Everything runs locally: no cloud calls, no npm dependencies.

![Supported answer with evidence](docs/screenshots/02-supported-answer.png)

## What it does

| Capability | How |
|---|---|
| Natural-language search | Query is interpreted into entity, attributes, place, time window and intent, then narrowed stage by stage (retrieval → semantic → temporal → grounding → cross-camera → verification). Each stage streams to the UI. |
| Grounded answers | Every answer cites camera + timestamp + frame, with the checks that passed or failed. If the evidence is not enough, it says so instead of guessing. |
| Clarify once, then remember | An unknown place ("north gate") triggers one question: pick the camera and drag over the area. The place is saved on the server and reused in every later query, across restarts. |
| Cross-camera journeys | Sightings of the same entity are chained into a route. Links are rated *likely same entity / likely continuation / possible continuation*, never stated as fact, and camera coverage gaps are always reported. |
| Your own footage | Upload recordings; they are indexed on this computer by a local vision model (Ollama `qwen3-vl:2b` by default) and searched with the same pipeline. |
| Playback with detections | Play any indexed recording with its tracked objects boxed and labelled, or switch to the original picture. H.265 and other codecs browsers cannot play get an H.264 copy during indexing. |
| Standing queries & alerts | "Notify me if anyone enters the rear entrance after 20:00" — evaluated against events as a recording is replayed. |
| Privacy | Face and plate masking, retention and expiry limits, operator roles, and an audit trail for every reveal. |

## Screenshots

| | |
|---|---|
| ![Landing](docs/screenshots/01-search-landing.png) **Search** | ![Journey](docs/screenshots/03-cross-camera-journey.png) **Cross-camera journey** |
| ![Clarify](docs/screenshots/04-clarify-unknown-place.png) **Asks once about an unknown place** | ![Refusal](docs/screenshots/05-refusal-verification.png) **Refuses when evidence is insufficient** |
| ![Live](docs/screenshots/10-live.png) **Replay with standing queries** | ![System](docs/screenshots/14-system.png) **Index coverage and sync** |
| ![Setup](docs/screenshots/00-first-launch-setup.png) **Local analysis setup** | ![Mobile](docs/screenshots/20-mobile.png) **Mobile layout** |

## Quick start

**Windows:** open **`Video Intelligence.exe`**. A small launcher window installs a private Node.js if needed (checksum-verified, no admin), starts the local server and opens the app. No console window appears. If an outdated server from before a `git pull` is still running, the launcher restarts it.

Other systems need Node.js 18+:

```bash
# Any OS
npm start                    # http://localhost:8000  (PORT, VI_STORE env vars)

# Tests: search flows, server validation, SSE, persistence, tracker, and (with ffmpeg) a full index run
npm run check
```

ES modules need an http origin, so opening `index.html` from disk does not work. `python -m http.server` also works, but only the demo dataset is available without the Node server.

### Searching your own footage

1. Start the server. On first launch a setup dialog offers to install **ffmpeg**, **Ollama** and a vision model (per-user, checksum-verified, no admin rights).
2. Switch the header to **My footage** and upload videos on the **Cameras** page with a name, timezone and start time.
3. Indexing runs in the background (resumes after a restart). On an RTX 3050 4 GB, `qwen3-vl:2b` takes about 5 s per sampled frame at 0.5 fps.

### Where to get footage

| Source | What | Access |
|---|---|---|
| [TfL JamCams](https://api.tfl.gov.uk/Place/Type/JamCam) | ~890 London traffic cameras, ~10 s MP4 clips refreshed every few minutes | Free, no key |
| [Caltrans CCTV](https://cwwp2.dot.ca.gov/documentation/cctv/cctv.htm) | California highway cameras; many with live HLS streams ffmpeg can record | Free, no key |
| [MEVA](https://mevadata.org) | ~330 h, 29 overlapping and non-overlapping cameras, people and vehicles, annotated | `aws s3 ls --no-sign-request s3://mevadata-public-01/` |
| [WILDTRACK](https://www.epfl.ch/labs/cvlab/data/data-wildtrack/) | 7 overlapping HD cameras, pedestrians, calibrated | Free download |
| CamNeT | 5-8 non-overlapping campus cameras with trajectories | Research dataset |

Details and caveats are in [HANDOFF.md](HANDOFF.md#footage-sources-researched).

## Two data sources

- **Demo**: a synthetic one-hour, seven-camera dataset (`data.js`), labelled *SYNTHETIC DEMO FRAME* everywhere. Search timings in this mode include simulated delays.
- **My footage**: your recordings, indexed locally by `indexer.mjs`. No simulated delays; the top candidates are re-checked by the vision model before an answer is given.

## How it works

```mermaid
flowchart LR
  V[Recordings] --> FF[ffmpeg sampling<br/>drop static frames]
  FF --> VLM[Local vision model<br/>objects, labels, boxes, faces, plates]
  VLM --> TR[Tracks → events]
  TR --> IDX[(Index)]
  Q[Question] --> INT[Interpret]
  INT -->|unknown place| ASK[Ask once → saved place]
  INT --> S[Staged search + verification]
  IDX --> S
  S --> A[Camera + time + frame + checks]
```

Detailed diagrams (modules, runtime modes, search pipeline, re-ID, alerts, UI, data model) are in [ARCHITECTURE.md](ARCHITECTURE.md). Per-file responsibilities, design rules and the full change log are in [HANDOFF.md](HANDOFF.md).

## Project layout

| File | Role |
|---|---|
| `app.js`, `index.html`, `styles.css` | UI (vanilla JS, string-template views) |
| `api.js` | Search pipeline, journeys, memory, watches; runs in the browser or on the server |
| `service.js`, `remote.js` | Picks the backend; REST + SSE client for the server |
| `server.mjs` | Node HTTP server: static files, REST, SSE, input validation, loopback-only binding |
| `indexer.mjs` | Upload queue, frame sampling, vision model calls, tracking, cross-camera linking |
| `setup.mjs` | Installs ffmpeg, Ollama and the model |
| `data.js`, `frame.js` | Demo dataset and frame rendering |
| `Video Intelligence.exe`, `launcher.cs`, `icon.ico` | Windows launcher window (source, build command inside `launcher.cs`) |
| `sw.js`, `offline.html`, `manifest.webmanifest` | Installable app; restarts the server from the app icon |
| `check.mjs` | Test suite |

## Known limitations

- **Query understanding is keyword-based.** The interpreter matches a fixed word list plus every word in the index. Queries using words the vision model never wrote down will miss.
- **No embedding retrieval yet.** Matching is on model-written descriptions, not vision-language embeddings.
- **Sparse sampling.** At 0.5 fps one person can split into several tracks.
- **Cross-camera links are description-based** and always shown as *possible*.
- **No baseline comparison or ablation yet.**
- **Live mode replays indexed footage**; there is no RTSP ingest.
- **Masking depends on the model** reporting faces and plates, which it often misses for distant CCTV figures.
- **No authentication**: the operator role is a setting.

## Development history

| Commit | Change |
|---|---|
| `e459c5d` | Core loop: search, evidence, journeys, saved places |
| `61cc21f` | Light/dark theme, contextual cursor |
| `46f9f87` | Node backend with REST, SSE search stages, file persistence |
| `2f271da` | Search depth, diagnostics, System page |
| `65b9219` | Privacy controls, roles, audited reveal |
| `5789e60` | Simulated live mode, standing queries, alerts |
| `bd38b3e` | Footage import and camera registration |
| `edb1e14` | Evidence board, pinned journeys, frame comparison |
| `8f7f7ad` | Opening demonstration |
| `e0557da` → `0460457` | One-click launcher, installable app, icon starts the server |
| `e7b78f4` | Windowless launcher, request guards (Host, Origin, content-type) |
| `5dfc129` | **Index and search your own recordings with a local vision model** |
| `720dcbf` | H.265 and other non-browser codecs become playable |
| `f693ad3` | Playback with tracked boxes, page transitions, new scrollbar |
| — | Launcher window replaces `Start.cmd`; outdated servers are restarted; setup dialog restyled |
