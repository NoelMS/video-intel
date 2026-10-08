# Architecture graphs

Visual map of the codebase. See `HANDOFF.md` for the prose version and change log.

## 1. Module dependency graph

```mermaid
graph TD
  index[index.html<br/>shell: #app, dialog#layer, #peek, #toasts]
  styles[styles.css<br/>tokens, themes, responsive]
  app[app.js<br/>UI: state S, views, layers, ACT actions]
  service[service.js<br/>picks backend: api + mode]
  api[api.js<br/>mock backend + pure logic<br/>pluggable storage]
  remote[remote.js<br/>fetch + EventSource client]
  frame[frame.js<br/>synthetic SVG camera stills]
  data[data.js<br/>demo cameras, events, referents, tracks]
  server[server.mjs<br/>Node: static + REST + SSE<br/>validation, guards, JSON file store]
  indexer[indexer.mjs<br/>upload queue, ffmpeg sampling,<br/>vision model per frame, tracks → events]
  setup[setup.mjs<br/>install ffmpeg, Ollama, model<br/>checksum-verified]
  ollama((Ollama<br/>qwen3-vl local model))
  ffmpeg((ffmpeg / ffprobe))
  check[check.mjs<br/>flow + server + tracker assertions]
  sw[sw.js<br/>offline fallback only]
  offline[offline.html<br/>fires video-intel://start, polls health]
  launcher[Video Intelligence.exe<br/>launcher window: ensure Node, restart stale server,<br/>start server hidden, open app window]

  index --> styles
  index --> app
  app --> service
  app --> frame
  app --> data
  service --> api
  service -. "only if meta vi-backend=server" .-> remote
  frame --> api
  frame --> data
  api --> data
  server --> api
  server --> indexer
  server --> setup
  indexer --> setup
  indexer --> ffmpeg
  indexer --> ollama
  check --> api
  check --> server
  sw --> offline
  launcher --> server
  remote -. "HTTP /api/*" .-> server
```

## 2. Runtime modes

```mermaid
flowchart LR
  subgraph Browser
    UI[app.js] --> SVC[service.js]
    SVC -->|STORE BROWSER| LAPI[api.js]
    LAPI --> LS[(localStorage)]
    SVC -->|STORE SERVER| RM[remote.js]
  end
  subgraph "Node server (127.0.0.1 / ::1)"
    SRV[server.mjs] --> VAL{validate<br/>trust boundary}
    VAL --> SAPI[api.js]
    SAPI --> FS[(.store/store.json)]
    SRV --> STATIC[static files<br/>+ inject meta vi-backend]
  end
  RM -->|REST| SRV
  RM -->|SSE: search stages, live replay| SRV
```

Static hosting (`python -m http.server`) never injects the meta tag, so the browser runs `api.js` directly against `localStorage`, and only the demo dataset is available.

## 2b. Indexing your own footage (`indexer.mjs`)

```mermaid
flowchart LR
  UP[POST /api/videos<br/>raw video body + name, tz, start] --> PROBE[ffprobe<br/>duration, size]
  PROBE --> Q[(persistent queue<br/>resumes after restart)]
  Q --> FR[ffmpeg fps=sampling<br/>+ mpdecimate drops static frames]
  FR --> VLM[Ollama qwen3-vl per frame<br/>JSON schema: objects, faces, plates, lighting]
  VLM --> DET[(detections.json)]
  DET --> TRK[track: overlap or ~1.5 body-lengths<br/>+ agreeing label words]
  TRK --> DS[dataset: events in data.js shape]
  DS --> XC[linkAcrossCameras<br/>shared words → POSSIBLE re-ID]
  DS --> API[api.useDataset → same search pipeline]
  API --> VER[verify: model re-checks top candidates<br/>yes / no / unsure + reason]
```

## 3. Search pipeline (`api.search`)

```mermaid
flowchart TD
  Q[query text] --> I[interpret<br/>regex: entity, attrs, location, follow,<br/>crossing, intent, after/before]
  I -->|place named but no referent| CL[status: clarify]
  I --> R[retrieval<br/>scope cameras, skip offline,<br/>report coverage gaps]
  R --> SEM[semantic<br/>entity + attrs + follow, top K by depth]
  SEM --> T[temporal<br/>inside window]
  T --> G[grounding<br/>on referent camera]
  G --> X[cross_camera<br/>tracks on >1 camera<br/>skipped in fast depth]
  X --> V[verification<br/>pathHits region crossing]
  V --> D{decide}
  D -->|journey intent| J[journey]
  D -->|activity intent| A[activity / empty]
  D -->|no verified, some rejected| RF[refusal]
  D -->|none| E[empty]
  D -->|single or clear winner| S[supported]
  D -->|close scores| AM[ambiguous]
```

Each stage emits through `onStage` (SSE on the server). Every result carries `funnel`, `coverage`, `rejected` and `diag`.

## 4. Re-identification and journeys (`api.journey`)

```mermaid
flowchart LR
  EV[events with same track<br/>sorted by time] --> HOP[consecutive pairs]
  HOP --> ADJ{cameras adjacent?}
  HOP --> VIS{visual ≥ 0.75?}
  ADJ & VIS -->|both| ST[strong<br/>LIKELY SAME ENTITY]
  ADJ & VIS -->|one| LK[likely<br/>LIKELY CONTINUATION]
  ADJ & VIS -->|neither| PS[possible<br/>POSSIBLE CONTINUATION]
  HOP --> GAP[coverage gaps on<br/>neighbouring cameras]
```

## 5. Live replay, watches and alerts

```mermaid
sequenceDiagram
  participant UI as app.js Live view
  participant L as api.live / GET /api/live (SSE)
  participant W as matchWatch
  participant S as store
  UI->>L: start(speed, from)
  loop every tick over recorded window
    L->>W: each arriving event vs active watches
    W-->>L: true / false / null (needs referent)
    L->>S: addAlert (dedup per watch+event)
    L-->>UI: onEvent, onAlert, onTick(stream states)
  end
  L-->>UI: end
```

## 6. UI structure (`app.js`)

```mermaid
graph TD
  R[render] --> H[header<br/>STORE mode, nav, theme]
  R --> VIEWS{S.view}
  VIEWS --> V1[searchView<br/>composer, interpretation, trail, result]
  VIEWS --> V2[liveView<br/>streams, feed, watches, alerts]
  VIEWS --> V3[camerasView<br/>coverage, upload + indexing status]
  VIEWS --> V4[memoryView<br/>saved places / referents]
  VIEWS --> V5[investigationView<br/>evidence board lanes, notes, export]
  VIEWS --> V6[systemView<br/>health, settings, privacy, audit]
  V1 --> RES{RESULT by status}
  RES --> supported & ambiguous & refusal & empty & activity & journeyResult
  journeyResult --> sequence & topology & timeline

  DLG[dialog#layer: openLayer] --> LAYERS{LAYERS}
  LAYERS --> evidence & compare & passport & resolver & diag & setup & register & video & intro & palette

  ACT[ACT: delegated data-act clicks] --> R
  ACT --> DLG
```

## 7. Data model

```mermaid
erDiagram
  CAMERA ||--o{ EVENT : records
  CAMERA ||--o{ REFERENT : "region defined on"
  TRACK ||--|{ EVENT : "sighted as"
  EVENT ||--o{ SAVED_ITEM : "kind=event"
  TRACK ||--o{ SAVED_ITEM : "kind=journey"
  WATCH ||--o{ ALERT : raises
  EVENT ||--o{ ALERT : triggers

  CAMERA {
    string id
    string status
    array coverage
    array neighbors
  }
  EVENT {
    string id
    string cameraId
    string time
    string track
    string entity
    array attrs
    object conf
  }
  REFERENT {
    string id
    string name
    string cameraId
    array region
  }
  SAVED_ITEM {
    string id
    string kind
    string lane
  }
  WATCH {
    string id
    string text
    string scope
    string from
    string to
  }
  ALERT {
    string id
    string watchId
    string eventId
  }
  VIDEO ||--|| CAMERA : "becomes (My footage)"
  VIDEO {
    string id
    string status
    string start
    string tz
    float sampling
  }
```

In "My footage" mode each indexed `VIDEO` becomes a `CAMERA`, and its tracks become `EVENT`s in the same shape as the demo data.
