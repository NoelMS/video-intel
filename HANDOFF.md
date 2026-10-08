# Agent handoff: Multi-Stream Video Intelligence

Read this first. It is updated with every major commit, so the newest entry in the change log matches `HEAD`.

## What this is

A frontend for natural-language search over recorded multi-camera footage. It covers search → interpretation → retrieval trail → grounded evidence → cross-camera journey → saved places → investigation notebook. The design spec it implements is the long "Multi-Stream Video Intelligence" prompt (175 sections). Its section numbers are cited below as §N.

**All data is synthetic demo data.** The UI says so ("DEMO DATA", "SYNTHETIC DEMO FRAME"). Never present mock values as real system output (§127).

## Run

```
npm start                       # node server.mjs: static + REST + SSE, persists to .store/store.json (PORT, VI_STORE env)
python -m http.server 8000      # static-only alternative: the in-browser mock backend is used, state in localStorage
npm run check                   # asserts the §174 flows plus server validation/SSE/restart persistence
```

The header shows `STORE SERVER` or `STORE BROWSER` so you can tell which backend is live. `service.js` decides at boot by probing `GET /api/health`.

ES modules need an http origin. Opening `index.html` from disk will not work.

## Files

| File | Role |
|---|---|
| `index.html` | Shell: `#app`, one `<dialog id="layer">`, `#peek` tooltip, `#toasts` |
| `styles.css` | Design tokens on `:root`, all styles, reduced-motion and responsive rules |
| `data.js` | Demo dataset: cameras, events, seed referents, track names |
| `api.js` | Mock backend; exports mirror §90 endpoints. Pure logic plus pluggable storage |
| `frame.js` | Synthetic SVG camera stills (stand-in for decoded video frames) |
| `service.js` | Backend selection: `{ api, mode }`. Pure helpers always from `api.js`, endpoints from `remote.js` when the server answers |
| `remote.js` | fetch/EventSource client for `server.mjs`, same signatures as `api.js` endpoints |
| `server.mjs` | Node (no deps): static files, `/api/*` REST, `POST /api/search` + `GET /api/search/:id/events` SSE, `DELETE /api/search/:id` cancels. Validates every write (trust boundary) |
| `package.json` | `type: module`, `start`/`check` scripts. No dependencies |
| `app.js` | UI: one state object `S`, string-template views, delegated `data-act` actions |
| `check.mjs` | Flow assertions against `api.js` (node) |

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

- **Opening sequence (§76)**: `introLayer`/`playIntro` is a scripted ~6 s demonstration labelled "DEMONSTRATION · scripted sequence on demo footage, not a live search". Steps are driven by `data-step` 0–5 with CSS transitions (query types, timeline brackets CAM 04, car grounds, CAM 06 links in, answer). It auto-plays once (`localStorage['vi.intro']`), replays from the landing link or palette, closes with Esc, and shows the final state only under reduced motion. "Run this search for real" runs the actual query. Test drivers should set `vi.intro=seen` before loading.

## Next up

Opening sequence.
