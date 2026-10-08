# Agent handoff: Multi-Stream Video Intelligence

Read this first. It is updated with every major commit, so the newest entry in the change log matches `HEAD`.

## What this is

A frontend for natural-language search over recorded multi-camera footage. It covers search → interpretation → retrieval trail → grounded evidence → cross-camera journey → saved places → investigation notebook. The design spec it implements is the long "Multi-Stream Video Intelligence" prompt (175 sections). Its section numbers are cited below as §N.

Two data sources, switched in the header (`settings.source`):
- **Demo**: synthetic cameras and events (`data.js`), labelled as such ("SYNTHETIC DEMO FRAME"). Never present them as real output (§127).
- **My footage**: your own recordings, indexed on this computer by a local Ollama vision model (`indexer.mjs`). This needs the server; static hosting only has the demo.

## Run

```
"Video Intelligence.exe"        # launcher window: Node 18+ (installs a private copy if missing), restarts a stale server, starts it hidden on :8000, opens the app window
npm start                       # node server.mjs: static + REST + SSE, persists to .store/store.json (PORT, VI_STORE env)
python -m http.server 8000      # static-only alternative: the in-browser mock backend is used, state in localStorage
npm run check                   # §174 flows, server validation/guards/SSE/persistence, tracker unit test, and (when
                                # ffmpeg is installed) a full upload -> extract -> index -> search run with a stub model
```

The header's Demo / My footage switch is disabled in static mode. `service.js` decides at boot from `<meta name="vi-backend" content="server">`, which `server.mjs` injects into `index.html` (no probe, so static hosting logs no 404). `GET /api/health` still exists for ops.

ES modules need an http origin. Opening `index.html` from disk will not work.

## Files

| File | Role |
|---|---|
| `index.html` | Shell: `#app`, one `<dialog id="layer">`, `#peek` tooltip, `#toasts` |
| `styles.css` | Design tokens on `:root`, all styles, reduced-motion and responsive rules |
| `data.js` | Demo dataset: cameras, events, seed referents, track names |
| `api.js` | Search pipeline and endpoint shapes (§90). Works over the active dataset (`useDataset`/`ds()`, `W` mutated in place). Pure logic plus pluggable storage (`kv` shared with the indexer). `search({ verify })` runs the visual check when the server passes one |
| `frame.js` | Camera stills as SVG: synthetic scenes for the demo, or the extracted frame for your footage (`realFrame`: nearest frame, the track's box on that exact frame, opaque redaction for faces and plates the model reported). Boxes live in 640x360 space; non-16:9 cameras are scaled vertically by `ky` so they keep their true shape |
| `setup.mjs` | Local-analysis dependencies: status (ffmpeg, Ollama, model) and a one-at-a-time install job. ffmpeg comes from the gyan.dev essentials zip (SHA-256 verified, unpacked with `System32\tar.exe`; a bare `tar` can be Git's GNU tar, which fails on zip). Ollama comes from the GitHub release `OllamaSetup.exe` (verified against `sha256sum.txt`, `/VERYSILENT` per-user install). The model is fetched with `/api/pull` (streamed progress). The detector: `onnxruntime-node` and `onnxruntime-common` 1.30.0 tarballs from the npm registry and `yolox_s.onnx` from the YOLOX 0.1.1rc0 GitHub release, all pinned by SHA-256, unpacked with `tar.exe` into `.runtime/detector-tmp` and renamed into place; other platforms' runtimes are deleted (100 MB on disk). `migrateModel()` in server.mjs offers it once to installs that predate it (`vision.detectorOffered`) |
| `detector.mjs` | Object detector: YOLOX-S (Apache-2.0, COCO) on ONNX Runtime from `.runtime/detector`, DirectML on Windows, else CPU. `frames()` reads a JPEG sequence through one ffmpeg as 640x640 letterboxed BGR (YOLOX's own preprocessing; padding grey 114, top-left). `detect()` decodes the raw head output (grid offsets, `exp` sizes, sigmoided objectness x class), keeps person/vehicle/animal/bag classes, runs NMS per class (plus 0.7 across classes of one kind, so a taxi is not both car and truck), and maps boxes to the 640x360 app space. `lighting()` is mean brightness. ~70-105 ms a frame on an RTX 3050 including decode |
| `indexer.mjs` | Your recordings: streams an upload to `.store/videos`, ffprobe metadata, a resumable queue. ffmpeg samples at `pipeline.sampling` fps with `mpdecimate` (drops static frames) and `showinfo` timestamps. `describeFrame` calls Ollama with a JSON schema. `track()` links detections (overlap or ~1.5 body-lengths, plus agreeing labels). `dataset()` builds the "mine" dataset in `data.js` shape. `linkAcrossCameras` gives "possible" re-identification by shared description words. `verify()` re-checks a candidate frame with the question. Sources the browser cannot play (codec not h264/vp8/vp9/av1, or container not mp4/m4v/webm/mov) first get an H.264 copy at `playFile(v)` (`<id>.play.mp4`, status `transcoding`) |
| `service.js` | Backend selection: `{ api, mode }`. Pure helpers always from `api.js`, endpoints from `remote.js` when the server answers |
| `remote.js` | fetch/EventSource client for `server.mjs`, same signatures as `api.js` endpoints |
| `server.mjs` | Node (no deps): static files, `/api/*` REST, `POST /api/search` + `GET /api/search/:id/events` SSE, `DELETE /api/search/:id` cancels. Validates every write (trust boundary). `GET /api/videos/:id/play` = browser-playable copy (or the source), `/file` = untouched original |
| `launcher.cs` → `Video Intelligence.exe` | The thing users open. WinForms, GUI subsystem, so no console ever. Built with the C# 5 compiler that ships with Windows (build command in the file header; commit the rebuilt exe). Up-to-date server already running: opens the app with no window. Otherwise it shows a borderless, DPI-aware, owner-drawn window (app colours, Segoe UI Variable / Cascadia Mono, accent progress line, Win11 rounded corners and border via DWM), and then: stops a stale `node` listener on 8000 (never kills another program), finds Node 18+ (PATH, Program Files, `.runtime\node`) or downloads the LTS zip with live MB progress and verifies SHA-256 before unpacking, registers `video-intel://` → `"exe" --background`, starts `server.mjs` with `CreateNoWindow`, `PORT=8000`, `VI_IDLE_EXIT=180000` and `VI_LOG=.runtime\server.log`, waits for health, then opens the app. Failure shows the reason with Open log / Close. `--preview <dir>` renders each state to PNG without doing anything (screen capture from an agent shell does not see new windows) |
| `icon.ico` | `icon-192.png` wrapped as a PNG-in-ICO; embedded into the exe with `/win32icon` |
| `manifest.webmanifest`, `icon.svg`, `icon-192.png`, `icon-512.png` | PWA install metadata. PNGs are rendered from `icon.svg` with headless Chrome (`--screenshot --default-background-color=00000000`) |
| `sw.js`, `offline.html` | The service worker's only job: when a navigation fails (server down, e.g. app opened from its installed icon) it serves `offline.html`, which fires `video-intel://start` (automatically, plus a button for when the browser wants a click), polls `/api/health`, and reloads into the app. It never caches the app or the API. Bump the cache name (now `vi-offline-v3`) when `offline.html` changes |
| `package.json` | `type: module`, `start`/`check` scripts. No dependencies |
| `app.js` | UI: one state object `S`, string-template views, delegated `data-act` actions. `loadDataset`/`switchSource`; first-launch setup prompt (`setupLayer`); upload with progress (`uploadFootage`, XHR); indexing status polling (`videosList`/`pollVideos`) |
| `check.mjs` | Flow assertions (node), offline |
| `sources.mjs` | Public footage, all free and keyless. **Directories**: `tfl()` (TfL JamCams, ~890, 10 s MP4 each, replaced every few minutes), `caltrans(d)` (Caltrans district 1-12, live HLS, in-service cameras only), `meva(prefix)` (unsigned S3 ListObjectsV2 on `mevadata-public-01`; filenames give date, local start/end, site and camera; `localToUtc` converts with `America/Indiana/Indianapolis`). **Feeds** (`vi.feeds`): `kind: 'clip'` refetches with `If-Modified-Since` (a 304 means no new clip, nothing is stored); `kind: 'stream'` records `clipSec` with `ffmpeg -c copy` (RTSP over TCP, HTTP read timeout 20 s, hard kill at clip + 90 s). The scheduler ticks every 15 s, captures only while the server runs (it does not keep the server alive), and skips captures while `indexer.backlog().clips >= MAX_BACKLOG` (12). **Imports** (in memory): sequential `setup.download` (resumable), then `indexer.addVideoFile`. A camera is a stable `cameraKey` (`feed-<sha1(url)>`, `meva-<camera>`, `url-<sha1>`) |
| `check-live.mjs` | Needs the internet and ffmpeg: real TfL clip, two real Caltrans HLS captures (one camera, two clips), a real MEVA import, and validation, all with a stand-in vision model. Run it after touching `sources.mjs` |

## Architecture rules

- Views take API objects only. To go live, swap the bodies in `api.js` and nothing else.
- Search streams stages through `onStage` (SSE-shaped). Stage counts are real counts from the index; only the delays are simulated.
- Re-identification is never stated as fact: `strong` = "LIKELY SAME ENTITY", `likely` = "LIKELY CONTINUATION", `possible` = "POSSIBLE CONTINUATION".
- Region crossing is computed from geometry (`pathHits`), not stored flags.
- Coverage gaps and offline cameras are always reported, never silently searched.
- Commits: don't list AI agents or coding tools as co-authors.

## Change log

- **Initial**: core loop and all 10 §174 flows. Supported, ambiguous, refusal and empty result states; evidence viewer; temporal zoom; journey (sequence, topology, timeline); referent resolver and memory; notebook and markdown export; command palette; privacy blur; responsive layout.

- **Theme + cursor**: light/dark/system theme (tokens redefined under `[data-theme]` and `prefers-color-scheme`; choice kept in `localStorage['vi.theme']`, set pre-paint in `index.html`). Camera frames stay dark on purpose because they stand in for footage. Contextual cursor label (`CURSOR` table in `app.js`) shows only for a fine pointer with motion allowed; it re-parents into the dialog while one is open, because of the top layer.

- **Server**: `server.mjs` + `remote.js` + `service.js`. `api.js` storage is pluggable via `useStorage()`, and the server plugs in a JSON file store. The search runs server-side and stages stream over SSE; abort maps to `DELETE /api/search/:id`. The client keeps working against static hosting through the mock fallback.

- **Depth, settings, diagnostics, System page**: `DEPTHS` in `api.js` (fast = top 3 with no cross-camera stage and no delay for the skipped stage; balanced = top 8; deep = all candidates plus 6 rejected). Depth comes from the composer select, else `settings.depth`. `GET/PUT /api/settings` is validated in `server.mjs`. Every result carries `diag` (depth, topK, retrieved ids with scores, pipeline identifiers). The diagnostics layer (`diagLayer`) shows retrieval outcomes, grounding, search cost tiers and per-stage latency deltas. The System view covers health, per-camera coverage, sync drift, failed segments, default depth and the pipeline form. Model identifiers are provenance only; no models run.

- **Privacy (§68–69)**: `settings.privacy` = faces, plates, onPrem, retentionDays, expiryDays, exports (allowed, watermarked or disabled); `settings.operator.role` = viewer, analyst or supervisor (no auth in the demo). Retention and expiry are enforced on read in `getHistory`/`getSaved`, and expired evidence is excluded from export. `pv()` in `app.js` feeds `frame()` (`privacy: {faces, plates}`), and frames burn in "FACE MASKED"/"PLATE MASKED". Reveal goes through `addAudit`, which enforces the supervisor role (403 from the server); `S.reveal` resets when the dialog closes. The audit trail is on the System page.

- **Live (simulated), standing queries, alerts (§32–34)**: `api.live()` replays the recorded window (it does not fake a live feed; every surface says "SIMULATED"). For each arriving event it runs `matchWatch` against active watches (schedules can span midnight via `inSchedule`; a watch naming an undefined place returns `null` and shows NEEDS REFERENT). Alerts are de-duplicated per watch and event across replays. The server streams the same replay over `GET /api/live?speed&from` (SSE: tick, event, alert, end). Watches use `/api/watches` CRUD (validated: text, scope, HH:MM). The Live view updates only its live regions per tick (`liveUpdate`) so the watch form keeps its input. Alert toasts link to evidence. The demo P21 path was moved just outside the Rear Entrance region to match its "waits near" label.

- **Import + registration (§116–118)**: the Cameras page has "Register camera" (files, folder via `webkitdirectory`, or rtsp/http URL; name, location, IANA timezone, start/end, neighbours, region labels). `probeVideo` decodes in the browser, reads duration and resolution, and extracts 12 frames with real progress (MediaRecorder WebM reports `Infinity` duration until seeked to the end, which is handled). 6 JPEG thumbs (240 px) are persisted via `/api/registrations` (server validates tz, dates, http(s)/rtsp only, JPEG data URLs under 80 kB). Status is `frames-extracted` or `awaiting-ingest`: **registered cameras are never searched**, because object/event indexing needs a backend indexer this build lacks, and the UI says so. Object URLs live in `SESSION_URLS` for the session only; after a reload the user re-attaches the file to play it.

- **Evidence board (§63) + comparison (§55)**: saved items are `{id, kind: event|journey, eventId|track, lane, query, savedAt}`; array order is board order. `norm()` upgrades pre-board records. Lanes are `api.LANES`. `moveItem(id, lane, index)` is the only reorder primitive (`PUT /api/saved/:id`; ids such as `journey:A17` are URL-encoded). Drag-and-drop uses native HTML5; the keyboard path is each card's lane select plus ↑/↓. "Pin journey to board" appears on journey results and passports. Tick Compare on frames, then use "Compare selected". Export groups items by lane and includes journeys.

- **Opening sequence (§76)**: `introLayer`/`playIntro` is a scripted ~6 s demonstration labelled "DEMONSTRATION · scripted sequence on demo footage, not a live search". Steps are driven by `data-step` 0–5 with CSS transitions (query types, timeline brackets CAM 04, car grounds, CAM 06 links in, answer). It plays only on demand (landing button or palette), never automatically, closes with Esc, and shows the final state only under reduced motion. "Run this search for real" runs the actual query. 

- **Regression + mobile pass**: every §174 flow plus each feature page was verified in both STORE BROWSER (static) and STORE SERVER modes with zero console errors. At ≤680 px the header wraps, wide tables scroll inside themselves, and no page scrolls horizontally.

- **One-click launcher**: `Start.cmd` → `start.ps1`. Tested: system Node, second click detecting the running server, and a forced portable download (v24.21.0, checksum verified). The winget path is not exercised in testing because it installs system-wide. PS 5.1 gotcha: assign `Invoke-RestMethod` JSON arrays to a variable before piping. `.cmd` files are kept CRLF via `.gitattributes`.

- **App window + PWA**: the launcher opens `--app=URL` in Edge (falling back to Chrome, then the default browser), so it runs as a standalone window. The app is installable (Chrome reports no `Page.getInstallabilityErrors`). The installed icon cannot start the server; `sw.js` covers that with the offline page. The installed app is tied to its origin (`http://localhost:8000`), and the launcher always prefers 8000.

- **Icon starts the server**: every normal `Start.cmd` run registers `HKCU\Software\Classes\video-intel` → `powershell -WindowStyle Hidden -File start.ps1 -Background` (the URL is never passed through, so there's no argument injection; re-registering keeps the path current if the folder moves). `-Background` starts `server.mjs` hidden with `VI_IDLE_EXIT=180000`, logging to `.runtime\server.log`. The server exits after 3 min with no requests and none open, and the open app pings `/api/health` every 60 s. The first time, Edge asks to open the launcher ("Always allow" makes it silent). **Security**: the server now binds loopback only (`127.0.0.1` plus a `::1` twin, because Windows tries `::1` first for `localhost` and stalls ~2 s on a refusal); `HOST` env overrides it. Verified: protocol → server up in ~3 s, the offline page reloads into the app, the LAN IP is unreachable, and `check.mjs` asserts the loopback bind and the idle exit.

- **No console + header + guards**: `Start.cmd` now sets up (Node, `node-path.txt`, builds `launcher.exe` when `launcher.cs` is newer, registers `video-intel://` → `launcher.exe`), runs the launcher, opens the app window and exits within ~3 s. Nothing stays open: 0 visible windows were verified for the server and its hidden console host. Wait on the launcher with `$p.WaitForExit()`, not `Start-Process -Wait`, which in PS 5.1 also waits for the spawned server. The port is fixed at 8000 (the PWA origin). With `VI_LOG` set, the server writes logs to a file (there is no console). Idle exit is deferred while `activity.busy()` (for the indexer). **Guards** (`guard()` in server.mjs): Host must be loopback (anti DNS-rebinding); non-GET with a foreign or `null` Origin gets 403; a POST with a CORS-safelisted or missing content-type gets 415 (forces a preflight that is never approved). Header status cluster: sentence-case sans, status dot, SVG icon buttons for privacy and theme, `<kbd>` keycaps; scrollbars use the standard `scrollbar-color`/`scrollbar-width` tokens.

- **Local video analysis (Ollama)**: replaces the "registered, never searchable" import.
  - **First launch** (server mode, `settings.vision.setupSeen` false) opens the setup prompt: install ffmpeg, Ollama and the vision model (choice of `qwen3-vl:2b-instruct` (default, fits 4 GB GPUs), `qwen3-vl:4b-instruct`, or any Ollama model name, e.g. one you have trained or imported). "Not now" sets `setupSeen`. It is also reachable from System → Local analysis.
  - **Upload**: `POST /api/videos?name&location&tz&start&neighbors&filename` with a raw `video/*` or `application/octet-stream` body (validated: extension allow-list, IANA tz, ISO start). Videos are served with Range support at `/api/videos/:id/file`, frames at `/frames/:n`.
  - **Model gotchas, all measured on qwen3-vl:2b / RTX 3050 4 GB / Ollama 0.31.2**:
    - `num_ctx: 4096` is required (the 256K default runs out of memory).
    - `think: false`, otherwise it reasons for ~40 s a frame.
    - With a schema, the JSON arrives in `message.thinking` and `content` is empty; read either.
    - The model repeats objects until the cap, so `maxItems` caps the grammar and `dedupe` drops overlapping duplicates.
    - The lean schema (type, label, box, action, faces, plates, lighting) takes ~5.4 s a frame; colour and attribute lists took ~45 s.
    - **Ollama 0.40.1**: plain `qwen3-vl:2b` ignores `think: false` and `/no_think` once a schema is set, and reasons until `num_ctx` runs out (2,940 tokens, 110 s, no JSON). Defaults are now the `-instruct` tags (`qwen3-vl:2b-instruct`, `4b-instruct`), which answer straight in `content`. If a thinking model is picked anyway, the error names the fix. Settings saved before this change still say `qwen3-vl:2b`; pick the instruct model in System → Local analysis.
    - The prompt has no example labels, because the 2B model copied "woman in red jacket with black backpack" onto strangers. `dedupe` also drops its repetition loop: the same label with an identical-size box stepped sideways.
    - Real run (0.40.1, 2b-instruct): three fresh TfL JamCam clips, one transcoded to H.265, indexed in ~10 min into 80 events. "Find a white van" was SUPPORTED with a visual check (it grounded a white car next to the van). Both codecs played with interpolated boxes, with 0 page errors.
    - The OpenCV `vtest.avi` (80 s, DivX 4:3) indexed in ~280 s at 0.5 fps into 88 events. "Show the white delivery van" is SUPPORTED with a visual check. "Woman in a red jacket" gives 3 plausible matches (fragments of the same person), with one candidate rejected by the visual check.
  - **Search over your footage**: no simulated delays; `interpret` vocabulary = demo words plus every word in the index; the visual check covers the top 3 (balanced) or 6 (deep) candidates, where "no" rejects the candidate with the model's reason and the checks show on the seal and comparison cards.
  - **Re-index** deletes frames and detections so a new sampling rate or model takes effect.
  - Saved items, audit rows, alerts and referents are filtered to the active dataset (`here()`, `memHere()`).
  - The demo opening plays only from its button.

- **Playback with detections, H.265, transitions, scrollbar**:
  - `videoLayer` plays `/api/videos/:id/play` with `#vbox` (HTML divs, percentages of the 640x360 box space, so labels never stretch) over the video; `boxAt` interpolates each track's `dets` and holds half a sampling interval at the ends. `V` holds the layer state; one `requestAnimationFrame` loop (`V.raf`) runs while the dialog is open. "With detections / Original" is `data-act=vmode`. Entry points: evidence view and the recordings list (`play-orig`, `data-det="0"` for original).
  - Verified with Playwright on two real TfL JamCam clips, one converted to H.265 (`libx265` in mkv): both play, boxes draw, Original draws none, zero console errors.
  - `go(view, after)` wraps page swaps in `document.startViewTransition` (skipped for reduced motion, open dialogs and same-page). The `vt-nav` class scopes the root slide/fade so the evidence morph keeps its own animation; `--vt-dir` is ±1 from nav order (`ORDER`). The header has its own transition name so it does not move. The swap is async, so focus/scroll work goes in `after`.
  - Scrollbars: `::-webkit-scrollbar` pill thumb (transparent border + `background-clip`); the standard `scrollbar-color` is inside `@supports not selector(::-webkit-scrollbar)` because Chromium ignores the pseudo-elements once it is set.
  - Fixed: Live page crashed in My footage mode when a watch was scoped to a demo camera (`cam(w.scope)` undefined).

- **Launcher window, stale server, setup dialog**:
  - `Start.cmd` and `start.ps1` are gone: any `.cmd` flashes a console. `Video Intelligence.exe` (see Files) does everything start.ps1 did, minus winget (a private Node in `.runtime\node` is always used when none is found). Untested path: a real Node download on a machine without Node; the index.json and SHASUMS regexes were checked against live nodejs.org (v24.21.0).
  - **Blank page cause**: a server started before a `git pull` kept running, because the open app pings `/api/health` every 60 s so idle exit never fires, and the old launcher treated any answering server as current. The new client then called routes the old server lacked (`/api/dataset` 404) and boot threw, leaving `#app` empty. Now `/api/health` returns `stale` (server-side code mtime > process start), the launcher restarts a stale or pre-`stale` server, and a boot failure renders a "Could not start" message instead of nothing. Verified on the real stale process (started 14:40, replaced, `/api/dataset` 200).
  - Setup dialog: sentence-case sans labels instead of mono caps (`.kicker`, `.pn`, `.tag`, `.pd`), SVG status marks, model choices as selectable cards (`:has(input:checked)`). `offline.html` label likewise; `sw.js` cache bumped to `vi-offline-v4`.
  - Scroll jump during installs: `pollSetup` called `openLayer`, which rebuilds and refocuses the top. It now swaps `dlg.innerHTML` and restores `dlg.scrollTop`. The first-launch auto-open also starts polling when a job is already running (it used to freeze). Verified with Playwright by mocking `/api/setup` (scrollTop 329 held across polls).

- **PR #1 review + indexing fixes** (merged PR #1, then fixed what review and field reports found):
  - **Binary check**: the committed `Video Intelligence.exe` was verified to be `launcher.cs` compiled. A fresh `csc` build of the source has the same size (22,528 bytes), the same icon and identical IL for all 66 methods, fields and resources (compared via reflection). After editing `launcher.cs`, rebuild with the command in its header and commit both.
  - **Launcher safety**: it used to kill any `node` answering `/api/health` on 8000. Now it only restarts a reply containing `"mode":"server"`, and anything else on the port is reported, never stopped (verified with a stand-in Node app). Node lookup ignores relative PATH entries.
  - **Console flashes while indexing**: when Ollama was not already running, `ensureOllama` started a detached `ollama serve`. With no console of its own, every runner it spawned (`llama-server`, GPU probes) got a console window: 18 flashes were measured while one model loaded. It also lost the tray app's custom models folder, giving "model not found". It now starts `ollama app.exe --hide` (Ollama's own way), falling back to a non-detached serve that shares the server's hidden console. Re-measured: 0 windows across a full re-index started with Ollama stopped.
  - **Leftover detached serve**: a PC that ran the old code keeps that orphaned `ollama serve` on port 11434. The tray app's own serve then fails ("ollama exited, exit status 1" every second in `%LOCALAPPDATA%\Ollama\app.log`), and the app keeps using the orphan, so the flashes come back. Once per run, `stopOrphanServe()` stops an `ollama.exe serve` on 11434 whose parent process is gone, and the tray app takes over within ~1 s. A serve started from a terminal has a living parent and is left alone. Verified by reproducing it: before, the port owner was an orphan; after, it was a serve whose parent is `ollama app`.
  - **"`<think>`… is not valid JSON" / "Unexpected end of JSON input"**: both were one bad model reply failing the whole recording.
    - The PR's `jsonIn` strips `<think>` blocks.
    - `describeSafely` retries an unusable reply once, then skips that frame (`failed` in detections).
    - A recording fails only if most frames, or 5 in a row, fail.
    - A reply that is pure reasoning is a property of the model, so it fails immediately with a pointer to an `-instruct` model.
    - Videos record `skipped` and `found`, and the UI explains skipped frames and an empty result. A screen recording has no people, vehicles, animals or bags, so 0 objects is the correct result.
  - **Thinking-model migration**: Ollama auto-updated to 0.40.1 mid-test (the tray app runs `OllamaSetup.exe` itself), after which plain `qwen3-vl:2b` reasoned through every reply. On start, `migrateModel()` moves saved `qwen3-vl:<n>b` to `-instruct` and clears `setupSeen`, so the prompt offers the download. A re-index with `qwen3-vl:2b-instruct` gave 366 detections and 0 skipped at ~13 s a frame on 0.40.1 (slower than the ~5 s measured on 0.31).
  - **Verified PR features in headless Chrome**: the DivX clip plays from its H.264 copy with 12 interpolated boxes at 0:03 and at 0:36, "Original" shows none, every page transition lands, zero console errors. Boxes trail walking people because detections are 2 s apart.

- **Live public cameras and archive import** (`sources.mjs`):
  - **Cameras page**: "Add live cameras" opens London (TfL picker, searchable, thumbnails), California (district picker) and Stream URL (any HLS/RTSP/MP4). "Import an archive" opens a MEVA browser (folder → day → hour → clips, with size, footage length and time-to-index estimate) and Video URLs (one per line, optionally all on one camera).
  - **Above the recordings**: a backlog line (clips waiting, footage length, "up to" time at the measured s/frame), live cameras (state, last capture, pause/remove, licence attribution) and imports.
  - **Clips group by camera**: `dataset()` merges all ready videos with one `cameraKey` into a single camera. Coverage = merged clip spans (gaps between captures show as coverage gaps). Frames carry `v` (clip id) and events carry `vid`/`vt` (clip id, clip time), so frame URLs, `verify()`, playback and downloads address the clip. `t` and `dets[].t` are camera time. The recordings list shows such a camera as one row (clips, indexed/waiting/failed, the clip being indexed now).
  - **One day at a time**: the time axis is seconds from local midnight, so an archive from 2018 and captures from today cannot share it. It put London captures at hour 75350. `dataset(day)` now holds one day's footage, defaulting to the latest; `days` lists the rest; `settings.day` (null = latest) is picked in the header. `getSettings`/`setSettings` used to spread any `typeof 'object'`, `null` included; a scalar setting with a null default needs the `v && typeof v === 'object'` guard.
  - **Times** of a recording display in the camera's own timezone, and the zone label uses the footage's date (EST vs EDT).
  - **Measured speed**: each indexed video records `secPerFrame`, and `indexer.backlog()` averages the last 10 for the estimates. Recent runs measured ~10-11 s a frame on qwen3-vl:2b-instruct / RTX 3050 4 GB / Ollama 0.40.1.
  - **Verified**: `check-live.mjs` passes. In the browser with the real model, the live captures and the MEVA clip were picked through the pickers, captured, indexed and searched:
    - TfL "Tooley St/Abbots Lane": 2 captures, one camera, 50 detections.
    - MEVA G339: 71 detections.
    - "Find the white SUV" on the 2018 day: candidates confirmed by the model's visual check.

- **Playback, empty-state and demo fixes** (`app.js`, `styles.css`):
  - **Detection boxes**: `drawBoxes` used to rebuild `#vbox` with `innerHTML` on every animation frame. Now `videoLayer` builds one node per track once, and each frame only sets `hidden` and `left/top/width/height`. Frames where `currentTime` is unchanged (paused, between video frames) skip the update.
  - **Page slide** is shorter (140 ms out, 280 ms in, 16 px) and no longer blurs the whole page. The app ignores input while a view transition runs.
  - **Removing recordings** now calls `clearSearch()`. Before, the last result still pointed at deleted events, so drawing the Search page threw and the Search tab "did nothing". `switchDay` uses the same helper.
  - **With nothing indexed**, the search composer still shows, the header line says so instead of "00:00 → 00:00 · 0 cameras", and a search returns "no supported evidence".
  - **"Watch the demonstration"** (and its palette entry) only shows on demo data. The scripted intro uses the demo's events and threw on your own footage.
  - **Verified in Chrome** against a stand-in model:
    - Boxes move with playback, with no DOM node churn and none drawn on "Original".
    - Delete a recording → Search → the page draws and searching works.

- **Indexing speed: 12.5 s → ~4 s a frame** (`indexer.mjs`). Measured on qwen3-vl:2b-instruct, RTX 3050 4 GB, Ollama 0.40.1, real TfL clips:
  - **Where the time went**: reading the image and prompt took 1 s (1,144 tokens). Writing the answer took 11.5 s (880 tokens at 77 tokens/s). On busy frames the model always filled all 12 object slots by looping, stepping one "man in a dark jacket" sideways across the frame. `dedupe()` threw those away, but they still cost ~70% of the time. It also missed most vehicles.
  - **Fix 1, stop at the loop**: `chat()` now streams, and `describeFrame` stops reading the answer at the first looped object (`streamedObjects`: same label on the same rows). Faces, plates and lighting moved ahead of `objects` in the schema and prompt, so the cut never loses a privacy box. That order also made the model list the taxis, vans and cars it used to miss.
  - **Fix 2, whole model on the GPU**: `num_gpu: 99`. Ollama's own estimate kept 20% of the model on the CPU, although the model fits (77 → 101 tokens/s). An Ollama out-of-memory error turns this off for the rest of the run. That fallback is untested, since this machine never ran out.
  - **Tried and rejected**:
    - Minified JSON: 709 → 660 tokens, not worth it.
    - `repeat_penalty: 1.3`: fewer loops, but it dropped real objects.
    - A pipe-separated line format with no schema: fewer tokens per object, but the model then wrote empty or junk replies.
  - **Higher sampling rates**, two ~10.7 s clips end to end, compared with ~6× real time at 0.5 fps before:

    | Rate | Frames | Time to index | × real time | Tracks |
    |---|---|---|---|---|
    | 0.5 fps | 5 | 20–32 s | 2–3× | 8–10 |
    | 1 fps | 11 | 41–51 s | 4–5× | 11–15 |
    | 2 fps | 21–22 | 87–118 s | 8–11× | 13–24 |

    `mpdecimate` drops almost nothing on busy roads, so frames grow in step with fps. Higher rates catch fast vehicles (motorbikes) that 0.5 fps skips, and boxes trail less. The default stays 0.5 fps.
  - **A detector is the next order of magnitude**, measured but not built in:
    - YOLO11n/s via ultralytics on the CPU took 50/95 ms a frame, 40-70x faster than the vision model. Its boxes were better too: it found every car, the scooter and the pedestrians on the Piccadilly frame.
    - The catch: it only knows class names (car, person, handbag...), with no colours or clothing.
    - Proposed hybrid: the detector runs every frame at 2-5 fps for boxes and tracks; the vision model labels one crop per track once (~15 output tokens).
    - It needs `onnxruntime-node` (the bundled gyan ffmpeg has no DNN filters) plus ONNX weights fetched by `setup.mjs`.
    - Licence: Ultralytics weights are AGPL-3.0, so prefer an Apache-2.0 model (YOLOX, RT-DETR, D-FINE, RF-DETR).
    - Training: fine-tuning a vision model for Ollama needs a CUDA PyTorch and more than 4 GB of VRAM. The local PyTorch is CPU-only. A detector pre-trained on COCO already covers people, vehicles and bags, so training only matters later. It would mean fine-tuning the detector on CCTV frames, using the vision model's labels.

- **CPU split and fallback, tested** (scratch scripts, not committed). Forcing layers onto the CPU with `num_gpu`:

  | Layers on the GPU | Writing | Reading the image | Per frame |
  |---|---|---|---|
  | 0 (all CPU) | 26 tokens/s | 20 s | ~69 s |
  | 10 | 29 tokens/s | 16 s | ~76 s |
  | 20 | 54 tokens/s | 16 s | ~56 s |
  | Ollama default (80% GPU) | 77 tokens/s | 1 s | ~12.5 s |
  | 99 (all) | 103 tokens/s | 0.9 s | ~7-8 s |

  The out-of-memory fallback was checked with a proxy that fakes Ollama's "cudaMalloc failed: out of memory" for `num_gpu: 99`. The first call retried without it and succeeded, and later calls left the split to Ollama.
- **Object detector (option B)** (`detector.mjs`, `indexWithDetector`):
  - **Install**: part of the same first-launch setup the launcher opens. The fourth row is "Object detector", and `setupReady` includes it. Indexing without it still works (the vision model alone, as before).
  - **Pipeline**:
    - Sample at 2 fps, or the configured rate if higher (`rate()`).
    - YOLOX finds objects in every frame, and `track()` links them, now keeping `src` (the frame's own object) so labels can be written back.
    - Each track seen in at least 2 frames and at least 16 px is named once from its largest sighting.
    - Actions come from movement along the track (walking/standing, driving/stopped).
    - Faces and plates: a generous head-area box per person and plate-area box per vehicle. This over-masks; there is no face/plate model.
  - **Naming**: two crops side by side in one picture per call, with fixed-choice schemas:
    - Vehicles: colour + body type. The body list also has the neighbouring classes, so a van the detector called a bus gets "van".
    - People: top colour, bottom colour and what they carry.
    - Anything else: colour only.

    Why: Ollama scales every picture up to ~1,100 tokens, and reading it is most of a call's time. One crop per call took ~2.2 s per object; two per picture ~1.1 s. Against single crops, two per picture agreed on the main colour 18 times in 20. A 2x2 grid (~0.5 s) only 14 in 20, drifting to "black". Free text took ~3 s and rambled ("car from cctv frame, blurry...").
  - **Measured** on five TfL clips (~10 s each), end to end through the indexer:

    | Path | Rate | × real time |
    |---|---|---|
    | Detector (this entry) | 2 fps | 1.0-2.9×, about 2× typical |
    | Vision model alone (previous entry) | 2 fps | 8-11× |

    With the detector, labels read like "white van", "black SUV", "person in black top and blue trousers, carrying a backpack". In the app: "Find the white van" and "Find the person carrying a bag" were confirmed by the visual check; "Did a red bus pass?" correctly found nothing; playback boxes follow the objects.
  - **Weak spots**:
    - Distant small vehicles get shaky labels.
    - The detector is weak on people under ~20 px.
    - A cancelled detector run restarts that step.
    - 2 fps stores 4× the frame JPEGs of 0.5 fps.

- **Capture now, and boxes that no longer run ahead**:
  - **"Capture now"** on each live camera (`POST feeds/:id/capture`, `sources.captureNow`):
    - Captures immediately, using the same code as the timer (`captureFeed`). It works on a paused camera and ignores the backlog limit, since a person asked for it.
    - The next timed capture counts from it.
    - A TfL camera only publishes a new clip every minute or so; forcing it before then answers "No new clip since the last capture" (TfL honours If-Modified-Since with 304).
    - The UI shows "Capturing…" and polls while a capture runs.
    - Tested on a paused Piccadilly Circus camera: captured in 5 s and indexed in 37 s, and the camera stayed paused.
  - **Timing bug**: every sampled frame showed the scene ~half a sampling interval after its stored time. The fps filter labels each slot with its start but keeps the slot's last frame. That's +0.24 s at 2 fps (+1 s at 0.5 fps), measured by matching each JPEG's pixels against every source frame, so playback boxes ran ahead of the objects.
  - **Fix**: frames are now picked with `select` (the first real frame of each 1/rate slot) and keep their own timestamps; measured 0.000 s off on three clips.
  - **Older recordings**: those indexed before (no `exactTimes` on the video) are shifted by 0.5/sampling in `dataset()`. Re-indexing makes them exact.

- **Capture now fixed, search usable during captures, no tracking gaps in still scenes**:
  - **Capture now did nothing**: the browser's request had no body, so `remote.js` sent no content type, and the server's CSRF guard answers a POST without a JSON content type with 415. The handler's rejection was unhandled, so the button failed silently. The check-script test passed only because it always sent the header.
    - Fix: `j()` sends JSON on every write, with or without a body.
    - `app.js` now toasts any unhandled rejection (except cancelled searches), so a failing action says why.
  - **Search "not working" while cameras capture**: each clip that finished indexing reloaded the dataset and re-rendered the page. That replaced the search box, so it lost focus mid-typing and later keystrokes went nowhere; the text survived in `S.query`, the cursor did not. `render()` now restores focus and the caret to the field with the same id. Searches themselves were fine during capture and indexing (measured 2-5 s).
  - **Tracking stopped for seconds**: `mpdecimate` drops frames that barely differ from the last kept one. A Caltrans clip had 13 -> 22 s and 0 -> 8.5 s with no frames, so no detections, and parked cars lost their boxes until something moved. With the detector, frames are no longer dropped (a frame costs ~0.1 s). The vision-model-only path still drops them, where it saves seconds a frame.
    - Measured on a 30 s Caltrans clip: 60 of 60 frames kept, a parked car tracked 0-29.5 s with 60 sightings, biggest gap 0.5 s.
    - Clips indexed before this keep their gaps until re-indexed.
  - **Verified** in the browser against a fresh test server: Capture now on a paused camera from the page, typing a search throughout the capture and indexing with focus kept, then the search returning matches.

- **Search results: all matches, short coverage notes, one clock**:
  - **Only 3 results**: an ambiguous answer kept `best.slice(0, 3)` for the comparison grid and dropped the rest. Now the result also carries `more` (the other matches), listed under the grid as "N MORE MATCHES", and they are marked on the timeline. Retrieval still caps at the depth's `topK` (Fast 3, Balanced 8, Deep all).
  - **One clock**: `dataset()` put each camera on its own local clock. A London capture at 17:00 and a California capture made at the same moment at 09:00 shared one axis, so the window spanned both, and every camera reported the other's hours as unsearched gaps. The search axis, day grouping and `TZ` now use this computer's timezone (`ZONE`). The recordings list and playback still show each camera's own zone.
  - **Coverage notes**: `coverageGaps()` is unchanged, but `coverage()` in app.js now writes one line per camera. A camera with more than two gaps gets a summary: "6m 02s of footage indexed between 19:16 and 22:06, in 35 clips. The 13h 00m between and around them was not searched." That is 3 lines instead of 42 on the real store.
  - `dur()` now formats hours.
  - **Verified** on a copy of the real store with live capture paused: "Find the white car" gives 8 plausible matches (3 compared + 5 listed); the header window is 09:00 → 22:06 GMT+5:30.

- **Capture now opens a window** (`captureLayer`, `submitCapture` in app.js):
  - **Record for**: 5-300 s, streams only. A TfL camera publishes fixed ~10 s clips, so its window says so and offers no length.
  - **Schedule**: capture every N minutes (2-1440), plus a checkbox (on by default) to record this long on every scheduled capture too.
  - **Server**: schedule changes go through `PUT feeds/:id` (now also accepting `clipSec`, validated 5-300 by `validClipSec`). The capture itself is `POST feeds/:id/capture {clipSec}`.
  - **One-off length**: `captureFeed(f, clipSec)` passes it to that capture only, so a one-off length never becomes the stored clip length. The feed row shows "every 5 min for 15 s" for streams.
  - **Verified in the browser** on a fresh store, with a Caltrans stream and a TfL camera:
    - A 15 s capture saved to the schedule recorded 15.0 s and stored every 5 min / 15 s.
    - An 8 s one-off with the box unticked recorded 8.0 s and kept 15 s stored.
    - The TfL window had no length field, and setting every 3 min worked.

- **Playback boxes, fullscreen, tracking accuracy, Cursor**:
  - **Cursor**: the merged branch `feature/playback-transitions` still held the original commits with the Cursor trailer, so it was deleted (all of it is in the local tag `backup/before-trailer-strip`). GitHub's contributors API lists NoelMS and roshanimmanuel792 only. PR #1's page keeps its original commits; GitHub does not allow rewriting them.
  - **Boxes moved before the objects**: `boxAt` interpolated towards the next sighting, so between samples a box slid to where the object would be up to half a second later, and appeared half an interval early. Now a box is the latest sighting at or before t, held until the next one, and gone one interval after the last; a gap in a track shows nothing.
  - **Timing**: boxes follow the frame actually on screen (`requestVideoFrameCallback` mediaTime) instead of `currentTime` in an animation frame, which runs a frame or two ahead of the picture.
  - **Fullscreen dropped the boxes**: the video element went full screen alone. Now `.vfs` (picture plus boxes) goes full screen, via the ⛶ button, a double-click or F. The player's own fullscreen is hidden (`controlslist=nofullscreen`), and redirected if a browser still offers it. Measured: in full screen the box layer and the video share the same rect and aspect.
  - **Tracking accuracy**:
    - **How it was measured** (scratch scripts, not committed): YOLOX on every frame of the five TfL clips (25 fps, 10,587 detections). At 40 ms apart, chaining by overlap gives reference identities. Each tracker was then scored on 2 or 5 fps samples by association precision/recall/F1 (are consecutive sightings in a track the same reference object, and are a reference object's consecutive sightings in one track).
    - **The reference is conservative**: it splits an object whenever the detector misses it for over 0.2 s, so the absolute numbers understate every tracker. Compare them with each other only.
    - **Results** (F1):

      | Tracker | 2 fps | 5 fps |
      |---|---|---|
      | Old greedy linker | 0.70 (precision 0.63) | 0.82 |
      | `track()` now | 0.82 | 0.90 (precision 0.83, recall 0.99) |

    - **What changed in `track()`**:
      - Global best-pairs-first matching per frame.
      - Constant-velocity prediction from the last three sightings.
      - Optional size check (areas within 4x).
      - Labels optional: the detector path doesn't compare class names, which flip between car and truck.
      - Detector settings: gate 0.75 box-sizes, tracks kept 2 s.
    - **Tried and not taken**: tighter gates and shorter keep times scored slightly higher only by splitting objects the way the reference does.
    - **Sampling**: with the detector, 5 fps (`rate()`), so held boxes are at most 0.2 s old and objects move less between frames.
    - **Stored tracks**: the indexer saves each object's track (`tk`) and `dataset()` uses it (`storedTracks`), so search sees exactly what was tracked and named. Older clips without `tk` are re-tracked as before.
    - **Naming**: only tracks seen for at least 1 s are named (blips keep the class name).
    - **Cost**: 5 fps measured 28 s and 43 s per ~10 s clip (2.6x and 4.3x real time), against ~2x at 2 fps; naming dominates.

- **Home, duplicate boxes, empty box, smooth tracking, real-footage README**:
  - **Home**: "← Home" at the start of every result's context bar, the logo, and the Search tab while a result is shown (`ACT.home`: `clearSearch()`, empty query, the search page). The Search tab from another page still returns to the result.
  - **Duplicate boxes**: `detector.mjs` also drops a box of the same kind that sits at least 85% inside another of comparable size (area ratio >= 0.35, so a small car in front of a bus stays). Nested same-kind pairs fell from 125 to 42 in 1,289 frames; tracking F1 0.900 -> 0.902.
  - **Empty box after an action** (e.g. saving a referent): `.resolver`'s `display: grid` beat the browser's `dialog:not([open])`, so the closed dialog stayed on screen as an empty bordered box. `dialog:not([open]) { display: none !important; }` fixes it for every layer. Reproduced and verified headlessly (closed dialog 1320x58 -> 0x0).
  - **Smooth boxes**: `boxAt` glides between consecutive sightings (at most 1.5 intervals apart) only once the object has been seen twice in a row. It holds at the first sighting, shows nothing in a gap, and vanishes one interval after the last sighting. Measured: a long-lived van's box moved on 23 video frames a second; a newcomer was hidden just before its first sighting and appeared exactly at it.
  - **README demo**: the hero is `docs/screenshots/playback.gif`, 6 s of a TfL JamCam at Tower Bridge with tracked, named objects. The screenshot table is real footage (search, result, evidence, playback, cameras, camera picker, Capture now, setup, system); the synthetic-scene images were deleted.
    - Captured with headless Chrome (`playwright-core`, `channel: 'chrome'`) against a test server that indexed three TfL clips. The GIF frames are the paused video seeked in 0.1 s steps, each screenshotted after `requestVideoFrameCallback` (frame-exact, no screen recording), then joined with the bundled ffmpeg (palettegen, 640 px, 10 fps).
    - Browser checks now run headless the same way, with no visible window.
  - **Cursor**: `main`, all branches and GitHub's contributors API are clean. The repo page's contributor sidebar (`/contributors_list`) still lists `@cursoragent`, from cached co-author data and/or `refs/pull/1/head` (PR #1's frozen commits, which GitHub does not let owners rewrite). Removing it needs GitHub Support (ask them to remove the PR #1 ref and cached views) or recreating the repository.

- **Problem-statement gap plan, phases 0-2** (plan: baseline, open-vocab, evaluation, write-up, then bonus items):
  - **README screenshots in dark mode**: recaptured headlessly with `colorScheme: 'dark'`.
  - **Image embeddings** (`embed.mjs`): MobileCLIP-S0 (image 46 MB fp32, text 43 MB int8) on the detector's ONNX Runtime (DirectML for images, CPU for text). The CLIP byte-level BPE tokenizer is in plain JS and matches CLIP's ids. Inputs: 256x256 RGB, pixels 0-1, no mean/std.
    - Setup now installs only missing detector items; existing installs get one prompt (`vision.imageSearchOffered`).
    - `embedVideo` (indexer.mjs) stores, per recording, `embeddings.bin` (Float32, 512-d) + `embeddings.json` rows: one per track (largest sighting, square crop with context) and one centre-crop frame per second. About 20 ms each.
    - Older detector-indexed recordings are backfilled while the queue is idle (3 test clips in 13 s). `storedTracks` keeps `tk`, and event ids use it, so embeddings are keyed `${vid}_${tk}`.
    - The System page's Frames and Embeddings columns show real counts for your footage.
  - **Baseline** (`baseline.mjs`, `POST /api/baseline/search`): CLIP frame retrieval over the same footage (1 frame/s, cosine with the query text, top-k frames -> camera + time). No detection, tracking, labels, memory or verification. `phrase()` strips question words, time phrases and remembered place names ("did a red car pass the main gate after 9:40?" -> "a photo of a red car"); both paths use it.
  - **Open-vocabulary ranking** (`openVocab` in api.js): with embeddings, an object's query similarity, as a percentile among the searched objects, is blended with the share of the query's attribute words in its label (`OPEN_VOCAB.imageWeight` 0.5). It passes if all attribute words match or the blend is >= `OPEN_VOCAB.pass` (0.75). The server computes similarities (`objectSimilarities`) and passes `sim` into `search()`. The demo is unchanged. Weights are to be tuned on the dev split in phase 4.

- **Phase 3: time phrases and answer clips**:
  - `timeWindow()` (api.js) understands "between 9 and 9:30", "at 9:14" (+-5 min; "at the gate" is not a time), "since"/"until", "this morning/afternoon/evening", "tonight", and "in the last hour / past 20 minutes / last half hour". The last kind is `recent`, which `search()` measures back from the end of the footage.
  - Answer clips: `GET /api/videos/:id/clip?t=&dur=` (2-60 s) re-encodes `dur` seconds centred on `t`, so the clip starts exactly there (verified: 4.000 s). It is served as an attachment and the temp file is removed afterwards. The evidence view has "Download clip (10 s)".
  - check.mjs covers time phrases, `phrase()`, the open-vocab blend and the CLIP tokenizer ids.

- **Phase 5: judge-day import and clarify-once, verified end to end**:
  - **Bulk import** (Add a recording):
    - The selection may include a `manifest.csv` (`file,camera,start,tz,location`; start is wall-clock time in tz). Each file's start is, in order: the manifest's; a time in the file name (`20240305_101500`, `2024-03-05T10-15-00`...); the recording time stored in the file (ffprobe `creation_time`, when "use the recording time stored in each file" is ticked); then the form's.
    - The server takes `startLocal` (wall clock + tz, converted with `sources.localToUtc`) and `startFrom=file`. `camera` sets `cameraKey`, so files of one camera are one camera.
  - **Verified headlessly** (playwright-core + system Chrome, against a server the test starts and restarts):
    - A manifest for two files plus a time-named third gave starts 14:09 / 14:16 / 14:08 UTC, with the two manifest files as one "Gate cam".
    - "Did a white van pass through the main gate?" asked once, then answered after the place was drawn. After a server restart the same question and a different one about the main gate were both answered without asking.
  - `setup.download`: a 416 on a resume when every byte has arrived now counts as complete (a MEVA import failed on it).

## Footage sources (researched)

Live feeds (for the live-ingest stretch goal; all free, check each licence before redistributing):
- **TfL JamCams** (London, ~890 cameras): `https://api.tfl.gov.uk/Place/Type/JamCam`. No key needed. Each camera has an `imageUrl` (JPEG) and a `videoUrl` (~10 s H.264 MP4, refreshed every few minutes). Verified working; good for quick real test clips.
- **Caltrans CCTV** (California): per-district JSON/CSV/XML at `https://cwwp2.dot.ca.gov/data/d{1..12}/cctv/cctvStatusD{01..12}.json`; cameras with `cctv.imageData.streamingVideoURL` are true live HLS (196 in District 4). Verified: `ffmpeg -i <playlist.m3u8> -t 4 -c copy out.mp4` records live H.264 (352x240). About half the listed streams return 404 at any moment even when `inService` is true, so probe before use. This is the most direct path to live ingest: record segments with ffmpeg and feed them to the existing indexer queue.
- **Maryland CHART**: ArcGIS feature service `mdgeodata.md.gov/.../MD_TrafficCameras/FeatureServer` with live-feed URLs.
- **Korea ITS**: `openapi.its.go.kr` `NCCTVInfo` returns live/MP4 CCTV URLs (needs a free key).

Recorded multi-camera datasets (for evaluation and the baseline comparison):
- **MEVA** (Kitware/IARPA): ~330 h, 29 cameras, overlapping and non-overlapping, persons and vehicles, activity annotations. `aws s3 ls --no-sign-request s3://mevadata-public-01/`. Best fit for this problem.
- **CamNeT**: 5-8 non-overlapping cameras on a campus, ground-truth trajectories; good for cross-camera re-ID.
- **WILDTRACK** (EPFL): 7 overlapping HD cameras, pedestrians, calibrated and synchronised.
- **AI City Challenge**: multi-camera vehicle and people tracking (registration required).

## Verifying changes

`npm run check` covers the logic and the server (the H.265 and full-pipeline parts need ffmpeg: `node -e "import('./setup.mjs').then(s=>s.install({ffmpeg:true}))"`).

For UI work use Playwright **outside the repo** so the project stays dependency-free: `npm i playwright` in a temp folder and `chromium.launch({ channel: 'msedge' })` (no browser download). Import `server.mjs`'s `start(port, storeFile)` and `indexer.configure({ describe })` in the same process to index real clips without Ollama; a stand-in `describe` must return boxes already in 640x360 `[x, y, w, h]` (what `describeFrame` produces), not the model's 0-1000 corners. Collect `pageerror` stacks and console errors. Playwright hides scrollbars; pass `ignoreDefaultArgs: ['--hide-scrollbars']` to see them. For mid-transition shots, screenshot ~120 ms after a nav click.

## Known limits (deliberate; do not paper over)

- The demo dataset is synthetic. On your footage, detections come from a small local model: labels are descriptive but not exhaustive, faces and plates are only masked when the model reports them (often not, for distant CCTV figures), and confidence is track persistence, not a calibrated score.
- Tracking samples one frame every 2 s by default, so a person can split into several tracks. Cross-camera links are by description only and always "possible".
- Playback boxes are interpolated between sampled frames (every 2 s by default), so they lag fast motion. Privacy masks are not applied to playback, only to extracted frames.
- Recordings indexed before the H.265 change have no playable copy; Re-index makes one.
- Event times are seconds from the first recording's local midnight. Footage spanning several days shows hours past 24.
- Live mode is a replay of indexed footage. Real ingest is the live cameras on the Cameras page: periodic clips, not a continuous stream, and only while the app is open.
- Throughput: with the object detector, about 2.5-4 s of compute per second of busy footage at 5 fps on a 4 GB GPU, mostly naming objects (busier scenes take longer). Without it, the vision model alone takes ~4 s a frame: 2-3x real time at 0.5 fps, 8-11x at 2 fps. The backlog line shows the measured rate.
- The search covers one day of your footage at a time (header day picker).
- Caltrans streams are often offline even when listed in service; a failed capture is shown on the feed and retried next interval.
- No authentication: the operator role is a setting. A real deployment must bind roles to identities server-side (`addAudit` already enforces the role from settings).
- Stage latencies include simulated delays (`DELAY` in `api.js`).
- Query understanding is a keyword/regex interpreter (`interpret`). A real deployment swaps in an LLM or parser behind the same output shape.

## Next up

Higher-recall tracking (a dedicated detector or tracker, or a higher sampling rate on a bigger GPU), embedding-based retrieval for open-vocabulary queries beyond exact description words, and live RTSP ingest feeding the same indexer.
