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
| `setup.mjs` | Local-analysis dependencies: status (ffmpeg, Ollama, model) and a one-at-a-time install job. ffmpeg comes from the gyan.dev essentials zip (SHA-256 verified, unpacked with `System32\tar.exe`; a bare `tar` can be Git's GNU tar, which fails on zip). Ollama comes from the GitHub release `OllamaSetup.exe` (verified against `sha256sum.txt`, `/VERYSILENT` per-user install). The model is fetched with `/api/pull` (streamed progress) |
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
| `check.mjs` | Flow assertions (node) |

## Architecture rules

- Views take API objects only. To go live, swap the bodies in `api.js` and nothing else.
- Search streams stages through `onStage` (SSE-shaped). Stage counts are real counts from the index; only the delays are simulated.
- Re-identification is never stated as fact: `strong` = "LIKELY SAME ENTITY", `likely` = "LIKELY CONTINUATION", `possible` = "POSSIBLE CONTINUATION".
- Region crossing is computed from geometry (`pathHits`), not stored flags.
- Coverage gaps and offline cameras are always reported, never silently searched.
- Commits: author `NoelMS <183172768+NoelMS@users.noreply.github.com>`, no co-author trailer.

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
- Live mode is a replay of indexed footage, not ingest.
- No authentication: the operator role is a setting. A real deployment must bind roles to identities server-side (`addAudit` already enforces the role from settings).
- Stage latencies include simulated delays (`DELAY` in `api.js`).
- Query understanding is a keyword/regex interpreter (`interpret`). A real deployment swaps in an LLM or parser behind the same output shape.

## Next up

Higher-recall tracking (a dedicated detector or tracker, or a higher sampling rate on a bigger GPU), embedding-based retrieval for open-vocabulary queries beyond exact description words, and live RTSP ingest feeding the same indexer.
