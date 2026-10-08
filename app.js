// UI: one state object, string templates, delegated events. Views take API objects only.
import { api, mode } from './service.js';
import { frame } from './frame.js';

const { sec, hms, dur, W } = api;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const hm = s => hms(s).slice(0, 5);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const ds = () => api.ds();                       // active dataset: the demo or your indexed footage
const cam = api.camera, ev = api.event, name = e => ds().tracks[e.track];
const article = s => (/^[aeiou]/i.test(s) ? 'an ' : 'a ') + s[0].toLowerCase() + s.slice(1);
const cap = s => s[0].toUpperCase() + s.slice(1);
const fmtSync = v => v == null ? '—' : `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(2)}s`;
const fmtDate = d => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const clipName = e => cam(e.cameraId).real ? `${cam(e.cameraId).name} at ${hms(Math.round(e.t))} into the recording` : `${e.cameraId.slice(4)}_${e.time.replace(/:/g, '')}.mp4`;
const STATUS = { supported: 'SUPPORTED', ambiguous: 'AMBIGUOUS', refusal: 'INSUFFICIENT', empty: 'INSUFFICIENT', activity: 'MATCHED', journey: 'MATCHED', clarify: 'REVIEWING' };
const STRENGTH = { strong: 'LIKELY SAME ENTITY', likely: 'LIKELY CONTINUATION', possible: 'POSSIBLE CONTINUATION' };

let cams = [], allEvents = [];
const S = {
  view: 'search', phase: 'idle', query: '', scope: 'all', stages: [], interp: null, res: null, context: null, error: null,
  memory: [], history: [], saved: [], notes: '', settings: api.DEFAULT_SETTINGS, depth: null, reveal: false, audit: [], watches: [], alerts: [], videos: [],
  live: { running: false, done: false, t: api.W[0], speed: 60, feed: [], streams: {}, lastAt: null, ac: null }, zoom: 0, jtab: 'sequence', resolver: null, layer: null, camFocus: null, abort: null,
};
const set = patch => { Object.assign(S, patch); render(); };

// Real footage hook: an event with `still` (image URL) renders it instead of the synthetic frame.
const still = (e, o = {}) => e?.still && !o.crop ? `<img class="frame" src="${esc(e.still)}" alt="${esc(e.label)}">`
  : frame(e ? e.cameraId : o.cameraId, { ev: e, privacy: pv(), ...o });
// Masking is on unless turned off in settings or temporarily revealed by a supervisor (audited).
const pv = () => ({ faces: S.settings.privacy.faces && !S.reveal, plates: S.settings.privacy.plates && !S.reveal });
const maskable = e => e.entity === 'person' ? S.settings.privacy.faces : S.settings.privacy.plates;
const exportBlock = () => S.settings.privacy.exports === 'disabled' ? 'Export is disabled by privacy policy'
  : S.settings.operator.role === 'viewer' ? 'The viewer role cannot export evidence' : null;

// ---------- small pieces ----------
const memHere = () => S.memory.filter(r => cam(r.cameraId));
const here = x => x.kind === 'journey' ? !!ds().tracks[x.track] : !!ev(x.eventId);   // saved item belongs to the active dataset
// Was the object detected in the frame nearest to (event time + offset)? Demo tracks are continuous by construction.
const tracked = (e, o) => { const c = cam(e.cameraId); if (!c.real) return true;
  const f = c.frames.reduce((a, b) => !a || Math.abs(b.t - e.t - o) < Math.abs(a.t - e.t - o) ? b : a, null);
  return !!f && e.dets.some(d => Math.abs(d.t - f.t) < 0.05); };
// Track ids for your footage are '<video id>:<n>'; people only need the number.
const tid = t => String(t).includes(':') ? '#' + String(t).split(':').pop() : t;
const xopt = () => ({ cross: S.res?.diag?.cross !== false });
const lv = v => `<span class="lv" data-n="${{ HIGH: 3, MEDIUM: 2, LOW: 1 }[v] ?? 0}"><i></i><i></i><i></i>${v}</span>`;
const tick = c => `<li class="${c.ok ? 'ok' : 'no'}"><span aria-hidden="true">${c.ok ? '✓' : '✕'}</span><span class="sr-only">${c.ok ? 'Passed' : 'Failed'}: </span>${esc(c.text)}</li>`;
const evRef = e => `<button class="ref mono" data-act="open" data-id="${e.id}">${cam(e.cameraId).code} · ${e.time}</button>`;
const fp = e => `<p class="fp mono" aria-label="Event fingerprint">${[e.entity, ...e.attrs, e.action, cam(e.cameraId).name, e.time.slice(0, 5)].map(w => `<span>${esc(w)}</span>`).join('')}</p>`;
const holes = c => api.coverageGaps([{ ...c, status: 'ready' }], W);
const indexed = c => { const s = c.coverage.reduce((n, [a, b]) => n + sec(b) - sec(a), 0); return `${Math.floor(s / 3600)}h ${String(Math.floor(s % 3600 / 60)).padStart(2, '0')}m`; };
const statusWord = c => ({ ready: 'INDEXED', partial: 'PARTIAL', offline: 'OFFLINE' })[c.status];

function density(c, clickable = false) {
  const p = t => ((t - W[0]) / (W[1] - W[0]) * 100).toFixed(2);
  const es = allEvents.filter(e => e.cameraId === c.id);
  return `<span class="density" ${clickable ? '' : `role="img" aria-label="${es.length} events, ${hm(W[0])} to ${hm(W[1])}"`}>
    ${holes(c).map(g => `<span class="gap ${c.status}" style="left:${p(g.from)}%;width:${(g.to - g.from) / (W[1] - W[0]) * 100}%"></span>`).join('')}
    ${es.map(e => clickable ? `<button class="mk" data-act="open" data-id="${e.id}" style="left:${p(sec(e.time))}%" aria-label="${e.time} ${esc(e.label)}"></button>` : `<i style="left:${p(sec(e.time))}%"></i>`).join('')}
  </span>`;
}

// ---------- header ----------
const svgIcon = d => `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  shield: svgIcon('<path d="M8 1.8 13 3.6v4c0 3.1-2.2 5.4-5 6.6-2.8-1.2-5-3.5-5-6.6v-4z"/><path d="m5.8 8 1.6 1.6 2.9-3.2"/>'),
  shieldOff: svgIcon('<path d="M8 1.8 13 3.6v4c0 3.1-2.2 5.4-5 6.6-2.8-1.2-5-3.5-5-6.6v-4z"/><path d="m2.5 2.5 11 11"/>'),
  light: svgIcon('<circle cx="8" cy="8" r="3"/><path d="M8 1v1.6M8 13.4V15M1 8h1.6M13.4 8H15M3 3l1.1 1.1M11.9 11.9 13 13M3 13l1.1-1.1M11.9 4.1 13 3"/>'),
  dark: svgIcon('<path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5 5.8 5.8 0 1 0 13.5 9.6z"/>'),
  system: svgIcon('<circle cx="8" cy="8" r="6"/><path d="M8 2v12" /><path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" stroke="none"/>'),
};
function header() {
  const nav = [['search', 'Search'], ['cameras', 'Cameras'], ['live', 'Live'], ['memory', 'Memory'], ['investigation', 'Investigation'], ['system', 'System']];
  return `<a class="skip" href="#main">Skip to content</a>
  <header class="top">
    <button class="mark" data-act="go" data-view="search">Multi-Stream <b>Video Intelligence</b></button>
    <nav aria-label="Primary">${nav.map(([v, l]) => `<button data-act="go" data-view="${v}" ${S.view === v ? 'aria-current="page"' : ''}>${l}</button>`).join('')}</nav>
    <div class="sys">
      ${!ds().DEMO && ds().days?.length > 1 ? `<label class="day-pick"><span class="sr-only">Day</span><select data-day aria-label="Day of footage">${ds().days.map(d => `<option value="${d}" ${d === ds().DAY ? 'selected' : ''}>${new Date(d + 'T12:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</option>`).join('')}</select></label>` : ''}
      <span class="mode" role="group" aria-label="Footage"><button aria-pressed="${!!ds().DEMO}" data-act="source" data-src="demo" title="Synthetic demo footage">Demo</button><button aria-pressed="${!ds().DEMO}" data-act="source" data-src="mine" ${mode === 'server' ? 'title="Your indexed recordings"' : 'disabled title="Needs the local server: open Video Intelligence.exe"'}>My footage</button></span>
      <button class="icon-btn" data-act="go" data-view="system" aria-label="Privacy masking ${pv().faces || pv().plates ? 'on' : 'off'}" title="Privacy masking ${pv().faces || pv().plates ? 'on' : 'off'}">${ICON[pv().faces || pv().plates ? 'shield' : 'shieldOff']}</button>
      <button class="icon-btn" data-act="theme" aria-label="Theme: ${theme()}" title="Theme: ${theme()}">${ICON[theme()]}</button>
      <button class="keys" data-act="palette" aria-label="Open command menu (Ctrl K)" title="Command menu"><kbd>Ctrl</kbd><kbd>K</kbd></button>
    </div>
  </header>`;
}

// ---------- search ----------
const MINE_STARTS = [
  ['Find a person', 'Entity'], ['Show vehicles', 'Entity'], ['Find someone in a red jacket', 'Attribute'],
  ['Where did the person go?', 'Cross-camera'], ['What happened at the entrance?', 'Place, defined once'],
];
const STARTS = [
  ['Did a red car pass through the main gate?', 'Point · saved place'],
  ['Where did the red car go?', 'Cross-camera'],
  ['What happened near the loading area?', 'Spatial · saved place'],
  ['Find the person carrying a large black bag', 'Attribute'],
  ['Did anyone enter the north gate?', 'Unknown place'],
  ['Did the maroon SUV pass through the main gate?', 'Verification'],
  ['Did anyone enter the lobby after 9:40?', 'Coverage'],
];

const composer = compact => `<form class="composer ${compact ? 'compact' : ''}" data-form="search" role="search">
  ${S.context ? `<p class="following mono"><span class="dim">FOLLOWING</span> ${esc(ds().tracks[S.context.track])} · ${tid(S.context.track)} <button type="button" class="txt" data-act="unfollow">clear</button></p>` : ''}
  <label class="sr-only" for="q">Describe what you are looking for</label>
  <textarea id="q" name="q" rows="${compact ? 2 : 3}" placeholder="${ds().DEMO ? 'Did a red car pass through the main gate?' : 'Describe what you are looking for'}" autocomplete="off">${esc(S.query)}</textarea>
  <div class="composer-row">
    <label class="mono">CAMERAS <select name="scope">
      <option value="all">All ${cams.length}</option>
      ${cams.map(c => `<option value="${c.id}" ${S.scope === c.id ? 'selected' : ''}>${c.code} · ${c.name}${c.status === 'offline' ? ' (offline)' : ''}</option>`).join('')}
    </select></label>
    <label class="mono">DEPTH <select name="depth" title="${esc(api.DEPTHS[S.depth ?? S.settings.depth].note)}">${Object.entries(api.DEPTHS).map(([k, d]) => `<option value="${k}" ${(S.depth ?? S.settings.depth) === k ? 'selected' : ''}>${d.label}</option>`).join('')}</select></label>
    ${S.phase === 'searching' ? '<button type="button" class="btn" data-act="cancel">Cancel search</button>' : '<button class="btn primary">Search</button>'}
  </div>
</form>`;

function searchView() {
  if (S.phase === 'idle') return `<section class="hero">
    <div class="hero-l">
      <p class="eyebrow">${cams.length ? `${ds().DAY} · ${hm(W[0])} → ${hm(W[1])} ${ds().TZ} · ${cams.length} camera${cams.length === 1 ? '' : 's'} · ${ds().DEMO ? 'demo footage' : 'your recordings'}` : 'Your recordings · nothing indexed yet'}</p>
      <h1>Search every camera like you remember the moment.</h1>
      <p class="lede">Ask naturally. Find the moment. Follow the evidence.</p>
      ${ds().DEMO ? `<button class="play-demo" data-act="intro"><span aria-hidden="true">▶</span> Watch the demonstration <span class="dim">6 s</span></button>` : ''}
      ${composer(false)}
      ${!ds().DEMO && !cams.length ? `<div class="empty-footage"><p><b>No indexed recordings yet.</b> Add recorded video and it is analysed on this computer.</p><button class="btn primary" data-act="register">Add a recording</button></div>` : ''}
      <ol class="starts" aria-label="Starting points">${(ds().DEMO ? STARTS : cams.length ? MINE_STARTS : []).map(([q, t], i) => `<li><button data-act="ask" data-q="${esc(q)}">
        <span class="mono dim">${String(i + 1).padStart(2, '0')}</span><span>${esc(q)}</span><span class="mono dim">${t}</span></button></li>`).join('')}</ol>
    </div>
    <aside class="hero-r" aria-label="Camera landscape" ${cams.length ? '' : 'hidden'}>
      <p class="eyebrow">CAMERA LANDSCAPE</p>
      <ul class="archive">${cams.map(c => `<li><button class="arc" data-act="camera" data-id="${c.id}">
        <span class="arc-still">${frame(c.id, { time: hms(W[0]) })}</span>
        <span class="arc-meta"><b class="mono">${c.code}</b> ${c.name} <span class="mono st-${c.status}">${statusWord(c)}</span></span>
        ${density(c)}</button></li>`).join('')}</ul>
    </aside>
  </section>`;
  return `<section class="split">
    <div class="rail">${composer(true)}${interpretation()}${trail()}</div>
    <div class="stage">${stage()}</div>
  </section>`;
}

function interpretation() {
  const q = S.interp;
  if (!q) return '';
  const rows = [];
  if (q.follow) rows.push(['FOLLOWING', `${esc(ds().tracks[q.follow.track])} · ${q.follow.track}`]);
  if (q.entity) rows.push(['ENTITY', q.entity]);
  if (q.attrs.length) rows.push(['ATTRIBUTE', q.attrs.join(' · ')]);
  if (q.location) rows.push(['LOCATION', q.location.ref ? referentChip(q.location.ref) : `${esc(q.location.term)} <span class="warn mono">UNDEFINED</span>`]);
  rows.push(['EVENT', q.intent === 'journey' ? 'movement across cameras' : q.intent === 'activity' ? 'any activity' : q.crossing ? 'crossing / entering' : 'presence']);
  rows.push(['TIME', q.after != null || q.before != null ? `${q.after != null ? 'after ' + hm(q.after) : ''} ${q.before != null ? 'before ' + hm(q.before) : ''}` : 'full recording']);
  return `<section class="interp" aria-label="How the query was interpreted"><p class="eyebrow">UNDERSTANDING</p>
    <dl>${rows.map(([k, v]) => `<div><dt class="mono">${k}</dt><dd>${v}</dd></div>`).join('')}</dl></section>`;
}

const referentChip = r => `<details class="refchip"><summary>${esc(r.name)} <span class="mono dim">${cam(r.cameraId).code} · saved visual referent</span></summary>
  ${frame(r.cameraId, { region: { rect: r.region, name: r.name }, time: hms(W[0]) })}
  <p class="mono dim">Defined by ${esc(r.definedBy)} · ${fmtDate(r.created)} · used in ${r.uses} searches</p></details>`;

const STAGES = [['interpreted', 'Interpret', ''], ['retrieval', 'Fast retrieval', 'FAST'], ['semantic', 'Semantic match', 'FAST'], ['temporal', 'Temporal filter', 'PRECISE'],
  ['grounding', 'Spatial grounding', 'PRECISE'], ['cross_camera', 'Cross-camera', 'DEEP'], ['verification', 'Verification', 'DEEP']];

function trail() {
  const done = new Map(S.stages.map(s => [s.stage, s]));
  const cur = S.phase === 'searching' ? STAGES.find(([k]) => !done.has(k))?.[0] : null;
  const max = Math.max(1, ...S.stages.map(s => s.count || 0));
  return `<section class="trail" aria-label="Search trail"><p class="eyebrow">SEARCH TRAIL <span class="dim">· ${ds().DEMO ? 'demo pipeline, simulated timings' : 'local pipeline, measured'}</span></p>
    <ol>${STAGES.map(([k, label, tier]) => {
      const s = done.get(k), state = s ? 'done' : k === cur ? 'run' : 'wait';
      const w = s?.count != null ? Math.max(1.5, Math.log10(s.count + 1) / Math.log10(max + 1) * 100) : 0;
      return `<li class="${state}" ${state === 'run' ? 'aria-current="step"' : ''}>
        <span class="tier mono">${tier}</span><span class="nm">${label}</span>
        <span class="ct mono">${s?.count ?? (state === 'run' ? '…' : '')}</span><span class="ms mono">${s ? s.ms + ' ms' : ''}</span>
        <span class="bar"><i style="width:${w}%"></i></span>${s && k !== 'interpreted' ? `<span class="lab">${esc(s.label)}</span>` : ''}</li>`;
    }).join('')}</ol>
    ${S.res?.diag ? `<p class="trail-foot"><span class="mono dim">${api.DEPTHS[S.res.diag.depth].label.toUpperCase()} · ${S.res.ms} ms</span> <button class="txt" data-act="diag">Diagnostics</button></p>` : ''}
    <p class="sr-only" aria-live="polite">${cur ? 'Running ' + STAGES.find(x => x[0] === cur)[1] : S.res ? 'Search complete: ' + STATUS[S.res.status] : ''}</p></section>`;
}

function stage() {
  const last = S.stages.at(-1);
  if (S.phase === 'searching') return `<div class="searching">
    <p class="verdict">SEARCHING FOOTAGE</p><h2 class="claim">“${esc(S.query)}”</h2>
    <dl class="kv"><div><dt>Scope</dt><dd>${S.scope === 'all' ? cams.length + ' cameras' : cam(S.scope).code}</dd></div><div><dt>Window</dt><dd>${hm(W[0])} → ${hm(W[1])} ${ds().TZ}</dd></div>
    <div><dt>Current stage</dt><dd>${STAGES.find(([k]) => !S.stages.some(s => s.stage === k))?.[1] ?? 'Composing'}</dd></div></dl>
    ${timeline({ dim: true })}</div>`;
  if (S.phase === 'clarifying') return resolver(S.resolver);
  if (S.phase === 'cancelled') return `<div class="state"><p class="verdict" tabindex="-1">SEARCH STOPPED</p>
    <h2 class="claim">${last?.count != null ? `Stopped after ${esc(last.label.toLowerCase())}: ${last.count}. Partial candidates are unverified, so no answer is shown.` : 'Stopped before any candidates were retrieved.'}</h2>
    <div class="acts"><button class="btn" data-act="ask" data-q="${esc(S.query)}">Resume search</button></div></div>`;
  if (S.phase === 'error') return `<div class="state"><p class="verdict ins" tabindex="-1">SEARCH INTERRUPTED</p><h2 class="claim">${esc(S.error)}</h2>
    <div class="acts"><button class="btn" data-act="ask" data-q="${esc(S.query)}">Retry</button><button class="txt" data-act="go" data-view="cameras">Inspect system status</button></div></div>`;
  const r = S.res;
  return `<div class="ctxbar mono"><span><b>QUERY</b> ${esc(S.query)}</span><span><b>TIME</b> ${hm(r.window[0])} → ${r.window[1] > r.window[0] ? hm(r.window[1]) : 'end'} ${ds().TZ}</span>
    <span><b>CAMERAS</b> ${r.scoped.length}</span><span><b>STATUS</b> ${STATUS[r.status]}</span></div>` + RESULT[r.status](r);
}

// ---------- results ----------
const RESULT = { supported, ambiguous, refusal, empty, activity, journey: journeyResult };

function supported(r) {
  const e = ev(r.primary), c = cam(e.cameraId), q = r.interp, ref = q.location?.ref;
  const claim = q.yesNo && ref && q.crossing ? `${cap(article(name(e)))} passed through the ${ref.name} at approximately ${e.time}.` : `${e.label}, ${e.time}.`;
  return `<article class="result">
    <header class="answer"><p class="verdict" tabindex="-1">${q.yesNo ? 'YES' : 'SUPPORTED RESULT'}</p>
      <h2 class="claim">${esc(claim)} ${evRef(e)}</h2></header>
    <figure class="lead" data-act="open" data-id="${e.id}" tabindex="0" role="button" aria-label="Open evidence ${c.code} ${e.time}">
      ${still(e, { trail: true, region: ref?.cameraId === e.cameraId ? { rect: ref.region, name: ref.name } : null })}
      <figcaption class="mono"><span>${c.code} · ${c.name.toUpperCase()}</span><span>${e.time} ${ds().TZ}</span><span>Open evidence ↵</span></figcaption>
    </figure>
    ${fp(e)}
    <div class="cols">${evidenceStack(e, q)}${seal(e, r.checks, ref)}</div>
    ${neighborhood(e)}${negative(r)}${alternatives(r.alternatives, e)}${constellation(e)}
    ${timeline({ hits: new Set([e.id]), focus: e })}${coverage(r)}
  </article>`;
}

function ambiguous(r) {
  return `<article class="result">
    <header class="answer"><p class="verdict amb" tabindex="-1">${r.candidates.length} PLAUSIBLE MATCHES</p>
      <h2 class="claim">The footage does not single out one ${r.interp.entity || 'candidate'}. Compare before concluding.</h2></header>
    ${compareGrid(r.candidates, r.interp)}${negative(r)}
    ${timeline({ hits: new Set(r.candidates), focus: ev(r.candidates[0]) })}${coverage(r)}
  </article>`;
}

function refusal(r) {
  const q = r.interp, ref = q.location?.ref, what = [...q.attrs, ...(q.attrs.some(a => ['sedan', 'van', 'suv', 'hatchback'].includes(a)) ? [] : [q.entity || 'object'])].join(' ').replace('suv', 'SUV');
  const missing = [...new Set(r.rejected.flatMap(x => x.checks.filter(c => !c.ok).map(c => c.text)))];
  return `<article class="result">
    <header class="answer"><p class="verdict ins" tabindex="-1">CANNOT DETERMINE</p>
      <h2 class="claim">The footage does not provide sufficient evidence to establish whether the ${esc(what)} ${ref && q.crossing ? 'passed through the ' + esc(ref.name) : 'matches the request'}.</h2></header>
    <dl class="kv"><div><dt>Evidence found</dt><dd>${r.rejected.length} similar ${r.rejected.length === 1 ? 'candidate' : 'candidates'}</dd></div>
      <div><dt>Missing</dt><dd><ul class="checks">${missing.map(t => tick({ ok: false, text: t })).join('')}</ul></dd></div></dl>
    <p class="mono">No conclusion was inferred.</p>
    ${negative(r)}
    <div class="acts"><button class="btn" data-act="compare" data-ids="${r.rejected.map(x => x.id)}">Inspect candidates</button><button class="txt" data-act="focus-q">Search again</button></div>
    ${coverage(r)}</article>`;
}

function empty(r) {
  const outside = r.window[0] >= W[1] || r.window[1] <= W[0];
  return `<article class="result">
    <header class="answer"><p class="verdict ins" tabindex="-1">NO SUPPORTED EVIDENCE FOUND</p>
      <h2 class="claim">The requested event could not be localized in the selected footage.</h2></header>
    <dl class="kv"><div><dt>Checked</dt><dd>${r.scoped.filter(id => cam(id).status !== 'offline').map(id => cam(id).code).join(', ') || 'no searchable cameras'}</dd></div>
      <div><dt>Requested</dt><dd class="mono">${hm(r.window[0])} → ${r.window[1] > r.window[0] ? hm(r.window[1]) : 'end of recording'}</dd></div>
      <div><dt>Available</dt><dd class="mono">${r.scoped.length === 1 ? cam(r.scoped[0]).coverage.map(([a, b]) => a.slice(0, 5) + ' → ' + b.slice(0, 5)).join(', ') : '09:00 → 10:00, except gaps below'}${outside ? ' · nothing indexed in the requested window' : ''}</dd></div>
      <div><dt>Possible reason</dt><dd>${r.coverage.length ? 'Part of the requested footage is missing (below).' : 'No matching visual evidence was found.'}</dd></div></dl>
    ${coverage(r)}${negative(r)}
    <div class="acts">
      ${r.interp.after != null || r.interp.before != null ? '<button class="btn" data-act="expand">Expand to full recording</button>' : ''}
      ${S.scope !== 'all' ? '<button class="btn" data-act="allcams">Search all cameras</button>' : ''}
      <button class="txt" data-act="focus-q">Revise query</button></div>
  </article>`;
}

function activity(r) {
  const ref = r.interp.location?.ref, n = r.events.length;
  return `<article class="result">
    <header class="answer"><p class="verdict" tabindex="-1">${n} EVENT${n === 1 ? '' : 'S'} ${ref ? 'AT ' + esc(ref.name.toUpperCase()) : 'IN SELECTED FOOTAGE'}</p>
      <h2 class="claim">${n} event${n === 1 ? ' was' : 's were'} observed${ref ? ' on ' + cam(ref.cameraId).code : ''} between ${hm(r.window[0])} and ${hm(r.window[1])}.</h2></header>
    <table class="events"><thead><tr><th scope="col">Still</th><th scope="col">Time</th><th scope="col">Camera</th><th scope="col">Event</th><th scope="col">Track</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${r.events.map(id => { const e = ev(id); return `<tr>
      <td><button class="thumb" data-act="open" data-id="${id}" aria-label="Open evidence ${e.time}">${still(e)}</button></td>
      <td class="mono">${e.time}</td><td class="mono">${cam(e.cameraId).code}</td><td>${esc(e.label)}${fp(e)}</td>
      <td><button class="txt mono" data-act="passport" data-track="${e.track}">${tid(e.track)}</button></td>
      <td><button class="txt" data-act="save" data-id="${id}">Save</button></td></tr>`; }).join('')}</tbody></table>
    ${timeline({ hits: new Set(r.events), focus: ev(r.events[0]) })}${coverage(r)}
  </article>`;
}

function journeyResult(r) {
  const j = r.journey, s = j.sightings.map(ev), [a, z] = [s[0], s.at(-1)];
  const strong = j.transitions.every(t => t.strength === 'strong');
  const claim = s.length === 1 ? `${ds().tracks[j.track]} was observed only once, at ${cam(a.cameraId).name}. No later sighting was found.`
    : `${ds().tracks[j.track]} was first observed at ${cam(a.cameraId).name} and next observed at ${cam(s[1].cameraId).name}; the last sighting is at ${cam(z.cameraId).name}.`;
  const tabs = [['sequence', 'Journey'], ['topology', 'Topology'], ['timeline', 'Timeline']];
  return `<article class="result">
    <header class="answer"><p class="verdict ${strong ? '' : 'amb'}" tabindex="-1">${s.length === 1 ? 'SINGLE SIGHTING' : strong ? 'SUPPORTED ROUTE' : 'LIKELY ROUTE'}</p>
      <h2 class="claim">${esc(claim)} ${s.map(evRef).join(' ')}</h2>
      ${strong ? '' : '<p class="mono dim">At least one link is a likely continuation, not a confirmed re-identification.</p>'}</header>
    <div class="tabs" role="tablist" aria-label="Views of the same evidence">${tabs.map(([k, l]) => `<button role="tab" aria-selected="${S.jtab === k}" data-act="jtab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div role="tabpanel">${S.jtab === 'topology' ? topology(j) : S.jtab === 'timeline' ? timeline({ hits: new Set(j.sightings), focus: a }) : sequence(j, a.id)}</div>
    ${r.alternatives.length ? `<section class="alts"><p class="eyebrow">NOT FOLLOWED</p>${r.alternatives.map(id => { const e = ev(id);
      return `<div class="alt"><span>${esc(name(e))}</span> ${evRef(e)} <button class="txt" data-act="compare" data-ids="${a.id},${id}">Compare</button> <button class="txt" data-act="follow" data-track="${e.track}">Follow instead</button></div>`; }).join('')}</section>` : ''}
    <div class="acts"><button class="btn" data-act="passport" data-track="${j.track}">Object passport</button><button class="txt" data-act="pin-journey" data-track="${j.track}">Pin journey to board</button></div>
    ${coverage(r)}
  </article>`;
}

// ---------- evidence building blocks ----------
function evidenceStack(e, q) {
  const A = Object.fromEntries(api.assess(e, q, xopt())), c = cam(e.cameraId), ref = q?.location?.ref;
  const j = api.journey(e.track), i = j.sightings.indexOf(e.id), prev = ev(j.sightings[i - 1]), next = ev(j.sightings[i + 1]);
  const layers = [
    ['VISUAL', 'What does it look like?', A['Visual match'], `${esc(e.label)}. Attributes: ${e.attrs.join(', ')}. Semantic match ${lv(A['Semantic match'])}`],
    ['TEMPORAL', 'When did it occur?', A['Temporal fit'], `<span class="mono">${e.time} ${ds().TZ}</span>. Clip ${hms(sec(e.time) - 8)} → ${hms(sec(e.time) + 8)}. Camera clock offset ${fmtSync(c.sync)}.`],
    ['SPATIAL', 'Where did it occur?', A['Location fit'], `${c.code} ${c.name}.${ref ? ` Trajectory ${api.pathHits(e, ref.region) ? 'intersects' : 'does not intersect'} the ${esc(ref.name)} region.` : ''}`],
    ['IDENTITY', 'Is it the same entity?', A['Cross-camera link'], `Track ${tid(e.track)}, ${j.sightings.length} sighting${j.sightings.length > 1 ? 's' : ''} on ${new Set(j.sightings.map(id => ev(id).cameraId)).size} camera(s). <button class="txt" data-act="passport" data-track="${e.track}">Object passport</button>`],
    ['SEQUENCE', 'What happened before and after?', 'N/A', `Before: ${prev ? evRef(prev) + ' ' + esc(prev.label) : 'no earlier sighting'}<br>After: ${next ? evRef(next) + ' ' + esc(next.label) : 'no later sighting'}`],
  ];
  return `<section class="stack" aria-label="Semantic evidence stack"><p class="eyebrow">EVIDENCE STACK</p>
    ${layers.map(([k, qq, v, body], n) => `<details ${n === 0 ? 'open' : ''}><summary><span class="mono k">${k}</span><span class="qq">${qq}</span>${v === 'N/A' ? '' : lv(v)}</summary><div>${body}</div></details>`).join('')}</section>`;
}

const seal = (e, checks, ref) => {
  const ok = checks.every(c => c.ok);
  return `<section class="seal" aria-label="Evidence provenance"><p class="eyebrow">${ok ? 'EVIDENCE VERIFIED' : 'PARTIALLY VERIFIED'}</p>
  <dl class="kv"><div><dt>Camera</dt><dd>${cam(e.cameraId).code}</dd></div><div><dt>Timestamp</dt><dd>${e.time} ${ds().TZ}</dd></div>
  <div><dt>Source clip</dt><dd>${clipName(e)}</dd></div><div><dt>Grounding</dt><dd>${ref ? 'Object + region' : 'Object'}</dd></div>
  <div><dt>Temporal match</dt><dd>Confirmed</dd></div></dl><ul class="checks">${checks.map(tick).join('')}</ul></section>`;
};

const neighborhood = e => `<section class="hood"><p class="eyebrow">EVIDENCE NEIGHBORHOOD</p><ol>${[-6, -3, 0, 3, 6].map(o =>
  `<li class="${o ? '' : 'match'}"><button data-act="open" data-id="${e.id}" data-off="${o}" aria-label="Open at ${hms(sec(e.time) + o)}">${still(e, { offset: o, box: !o })}</button>
  <span class="mono">${hms(sec(e.time) + o)}${o ? '' : ' · MATCH'}</span><span class="mono dim">${o < 0 ? 'BEFORE' : o > 0 ? 'AFTER' : 'DURING'}</span></li>`).join('')}</ol></section>`;

const negative = r => !r.rejected?.length ? '' : `<section class="negative"><p class="eyebrow">CANDIDATES REJECTED</p>${r.rejected.map(x => { const e = ev(x.id);
  return `<div class="rej"><button class="thumb" data-act="open" data-id="${e.id}" aria-label="Open rejected candidate ${e.time}">${still(e)}</button>
  <div><p><b>${esc(name(e))}</b> ${evRef(e)}</p><ul class="checks">${x.checks.map(tick).join('')}</ul></div></div>`; }).join('')}</section>`;

const alternatives = (ids, p) => !ids?.length ? '' : `<section class="alts"><p class="eyebrow">ALTERNATIVE${ids.length > 1 ? 'S' : ''}</p>${ids.map(id => { const e = ev(id);
  return `<div class="alt"><span>${esc(name(e))}</span> ${evRef(e)} <span class="mono dim">visual ${api.level(e.conf.visual)}</span> <button class="txt" data-act="compare" data-ids="${p.id},${id}">Compare side by side</button></div>`; }).join('')}</section>`;

const constellation = e => { const j = api.journey(e.track);
  return j.sightings.length < 2 ? '' : `<section class="constellation"><p class="eyebrow">EVIDENCE CONSTELLATION · TRACK ${tid(e.track)}</p>${sequence(j, e.id, true)}
  <button class="txt" data-act="follow" data-track="${e.track}">Open journey →</button></section>`; };

function sequence(j, primary, compact = false) {
  return `<ol class="seq ${compact ? 'compact' : ''}">${j.sightings.map((id, i) => { const e = ev(id), c = cam(e.cameraId), t = j.transitions[i - 1];
    return `${t ? transition(t) : ''}<li class="sight ${id === primary ? 'primary' : ''}">
      <button class="sight-frame" data-act="open" data-id="${id}" aria-label="Open ${c.code} ${e.time}">${still(e, { crop: compact })}</button>
      <div><p class="t mono">${e.time}</p><p class="c">${c.name.toUpperCase()} <span class="mono dim">${c.code}</span></p><p>${esc(e.label)}</p>
      <p class="mono dim">${id === primary ? 'PRIMARY' : 'SUPPORTING'} · visual ${api.level(e.conf.visual)}</p></div></li>`; }).join('')}</ol>`;
}

const transition = t => `<li class="tr tr-${t.strength}"><span class="line" aria-hidden="true"></span><div>
  <p class="mono">↓ ${dur(t.gap)} · <b>${STRENGTH[t.strength]}</b></p><ul class="checks">${t.reasons.map(tick).join('')}</ul>
  ${t.gaps.length ? `<p class="warn mono">Not observable: ${t.gaps.map(g => `${cam(g.cameraId).code} ${g.kind === 'offline' ? 'offline' : hm(g.from) + '–' + hm(g.to) + ' no footage'}`).join(', ')}</p>` : ''}
  <button class="txt" data-act="bridge" data-from="${t.from}" data-to="${t.to}">Compare frames</button></div></li>`;

const POS = { cam_02: [90, 60], cam_03: [90, 210], cam_04: [250, 135], cam_06: [410, 60], cam_07: [410, 210], cam_08: [570, 60], cam_09: [570, 210] };
const pos = id => POS[id] ?? (i => [80 + Math.floor(i / 2) * 160, i % 2 ? 210 : 60])(cams.findIndex(c => c.id === id));
function topology(j) {
  const path = j.sightings.map(id => ev(id).cameraId);
  const edges = cams.flatMap(c => c.neighbors.filter(n => c.id < n).map(n => [c.id, n]));
  const hop = (a, b) => path.some((p, i) => i && [path[i - 1], p].sort().join() === [a, b].sort().join());
  const jumps = path.slice(1).map((p, i) => [path[i], p]).filter(([a, b]) => !edges.some(e => e.sort().join() === [a, b].sort().join()));
  return `<figure class="topo"><svg viewBox="0 0 ${Math.max(660, 160 + Math.ceil(cams.length / 2) * 160)} 270" role="img" aria-label="Camera topology with journey ${path.map(p => cam(p).code).join(' to ')}">
    ${edges.map(([a, b]) => `<line x1="${pos(a)[0]}" y1="${pos(a)[1]}" x2="${pos(b)[0]}" y2="${pos(b)[1]}" class="${hop(a, b) ? 'on' : ''}"/>`).join('')}
    ${jumps.map(([a, b]) => `<line x1="${pos(a)[0]}" y1="${pos(a)[1]}" x2="${pos(b)[0]}" y2="${pos(b)[1]}" class="jump"/>`).join('')}
    ${cams.map(c => { const [x, y] = pos(c.id), k = path.indexOf(c.id); return `<g class="node ${k >= 0 ? 'on' : ''} ${c.status}">
      <circle cx="${x}" cy="${y}" r="${k >= 0 ? 7 : 4}"/>${k >= 0 ? `<text x="${x}" y="${y + 3.5}" class="n" text-anchor="middle">${k + 1}</text>` : ''}
      <text x="${x}" y="${y - 16}" text-anchor="middle">${c.code}</text><text x="${x}" y="${y + 26}" text-anchor="middle" class="sub">${c.name}</text></g>`; }).join('')}
  </svg><figcaption class="mono dim">Relationships from camera registration, not geography. Dotted: hop between cameras that are not directly connected.</figcaption></figure>`;
}

const DEG = [['occlusion', 'Occlusion', v => v], ['blur', 'Motion blur', v => v], ['lighting', 'Lighting', v => v], ['angle', 'View angle', v => ({ good: 'frontal', medium: 'oblique', high: 'steep' })[v] ?? v]];
const degradation = e => { const q = e.quality, bad = q.blur === 'high' || q.lighting === 'low' || ['medium', 'high'].includes(q.occlusion) || q.angle === 'high';
  return `<section class="deg ${bad ? 'bad' : ''}"><p class="eyebrow">${bad ? 'EVIDENCE DEGRADATION' : 'VISUAL QUALITY'}</p>
  <dl>${DEG.filter(([k]) => q[k] !== 'unknown').map(([k, l, f]) => `<div><dt>${l}</dt><dd class="mono">${f(q[k]).toUpperCase()}</dd></div>`).join('')}</dl></section>`; };

const compareGrid = (ids, q) => `<div class="compare" style="--n:${ids.length}">${ids.map((id, i) => { const e = ev(id), c = cam(e.cameraId);
  return `<section class="cand" aria-label="Candidate ${'ABC'[i]}"><p class="eyebrow">CANDIDATE ${'ABC'[i]}</p>
    <button class="cand-frame" data-act="open" data-id="${id}" aria-label="Open candidate ${'ABC'[i]}">${still(e)}</button>
    <div class="crop">${still(e, { crop: true })}</div>
    <p class="t mono">${c.code} · ${e.time}</p><p>${esc(e.label)}</p>
    ${S.res?.visual?.[id] ? `<ul class="checks">${tick(S.res.visual[id])}</ul>` : ''}
    <dl class="layers">${api.assess(e, q, xopt()).map(([k, v]) => `<div><dt>${k}</dt><dd>${lv(v)}</dd></div>`).join('')}</dl>
    ${degradation(e)}
    <div class="acts"><button class="btn" data-act="open" data-id="${id}">View evidence</button><button class="txt" data-act="follow" data-track="${e.track}">Follow</button></div></section>`; }).join('')}</div>`;

function coverage(r) {
  return !r.coverage.length ? '' : `<section class="coverage"><p class="eyebrow warn">COVERAGE</p><ul>${r.coverage.map(g => { const c = cam(g.cameraId);
    return g.kind === 'offline' ? `<li><b class="mono">${c.code}</b> OFFLINE, not searched. Available footage ${g.available.map(([a, b]) => a.slice(0, 5) + ' → ' + b.slice(0, 5)).join(', ')}.</li>`
      : `<li><b class="mono">${c.code}</b> No footage indexed ${hm(g.from)} → ${hm(g.to)}. This interval was not searched.</li>`; }).join('')}</ul></section>`;
}

// ---------- multi-camera timeline with temporal zoom ----------
const SPANS = [3600, 900, 120, 30], SPAN_L = ['1 h', '15 min', '2 min', '30 s'], STEP = { 3600: 600, 900: 120, 120: 15, 30: 5 };
const domain = (z, f) => { const span = SPANS[z], c = f ?? (W[0] + W[1]) / 2; return [clamp(c - span / 2, W[0], W[1] - span), span]; };
const ticks = (a, span) => { const st = STEP[span], out = [];
  for (let t = Math.ceil(a / st) * st; t <= a + span; t += st) out.push(`<span style="left:${(t - a) / span * 100}%">${span > 120 ? hm(t) : hms(t)}</span>`);
  return out.join(''); };

function timeline({ hits = new Set(), focus = null, dim = false } = {}) {
  const f = focus ? sec(focus.time) : null, z = f ? S.zoom : 0, [a, span] = domain(z, f), p = t => (t - a) / span * 100;
  return `<section class="tl ${dim ? 'dim' : ''}" data-focus="${f ?? ''}" aria-label="Multi-camera timeline">
    <div class="tl-head"><p class="eyebrow">ALL CAMERAS · TIMELINE</p>
      <div class="zoom mono" role="group" aria-label="Temporal zoom">${SPAN_L.map((l, i) => `<button data-act="zoom" data-z="${i}" aria-pressed="${z === i}" ${!f && i ? 'disabled' : ''}>${l}</button>`).join('')}</div></div>
    <div class="tl-row tl-ticks mono" aria-hidden="true"><span></span><div class="tl-track">${ticks(a, span)}</div></div>
    ${cams.map(c => `<div class="tl-row"><span class="tl-lab mono">${c.code} <span class="dim">${c.name}</span></span><div class="tl-track">
      ${holes(c).map(g => `<span class="tl-gap ${c.status}" data-t="${g.from}" data-t2="${g.to}" style="left:${p(g.from)}%;width:${(g.to - g.from) / span * 100}%"></span>`).join('')}
      ${f ? `<span class="tl-now" data-t="${f}" style="left:${p(f)}%"></span>` : ''}
      ${allEvents.filter(e => e.cameraId === c.id).map(e => `<button class="mk ${hits.has(e.id) ? 'hit' : ''}" data-act="open" data-id="${e.id}" data-t="${sec(e.time)}" style="left:${p(sec(e.time))}%" aria-label="${e.time} ${c.code} ${esc(e.label)}"></button>`).join('')}
    </div></div>`).join('')}
  </section>`;
}

function zoomTo(z) {
  S.zoom = z;
  $$('.tl').forEach(tl => {
    const [a, span] = domain(z, +tl.dataset.focus || null);
    $$('[data-t]', tl).forEach(el => {
      el.style.left = (el.dataset.t - a) / span * 100 + '%';
      if (el.dataset.t2) el.style.width = (el.dataset.t2 - el.dataset.t) / span * 100 + '%';
    });
    $('.tl-ticks .tl-track', tl).innerHTML = ticks(a, span);
    $$('[data-act=zoom]', tl).forEach(b => b.setAttribute('aria-pressed', +b.dataset.z === z));
  });
}

// ---------- other views ----------
function camerasView() {
  const avail = cams.filter(c => c.status !== 'offline'), gaps = api.coverageGaps(cams, W);
  return `<section class="page"><header class="page-h"><p class="eyebrow">CAMERAS</p><h1>The archive.</h1>
    <p class="lede">${cams.length} indexed camera${cams.length === 1 ? '' : 's'}${cams.length ? ` · ${ds().DAY} · ${hm(W[0])} → ${hm(W[1])} ${ds().TZ}` : ''}. ${ds().DEMO ? 'Synthetic demo footage.' : 'Your recordings, analysed on this computer.'}</p>
    ${ds().DEMO ? '' : '<div class="acts"><button class="btn" data-act="register">Add a recording</button><button class="btn" data-act="src-open" data-tab="tfl">Add live cameras</button><button class="btn" data-act="src-open" data-tab="meva">Import an archive</button></div>'}</header>
    ${ds().DEMO ? '' : `<div id="videos">${videosList()}</div>`}
    ${cams.length ? `<section class="health" aria-label="Index health"><dl class="kv">
      <div><dt>Cameras</dt><dd>${avail.length} / ${cams.length} available</dd></div>
      <div><dt>Index</dt><dd>Complete for available footage</dd></div>
      <div><dt>Events indexed</dt><dd>${allEvents.length}</dd></div>
      <div><dt>Coverage gaps</dt><dd>${gaps.map(g => `${cam(g.cameraId).code} ${g.kind === 'offline' ? 'offline' : hm(g.from) + '–' + hm(g.to)}`).join(' · ') || 'none'}</dd></div>
      <div><dt>Visual memory</dt><dd>${memHere().length} referents</dd></div></dl></section>
    <table class="cams"><thead><tr><th scope="col">Camera</th><th scope="col">Status</th><th scope="col">Activity ${hm(W[0])} → ${hm(W[1])}</th><th scope="col">Indexed</th><th scope="col">Clock offset</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${cams.map(c => `<tr id="row-${c.id}" class="${S.camFocus === c.id ? 'focus' : ''}">
      <th scope="row"><span class="thumb">${frame(c.id, { time: hms(W[0]) })}</span><span><b class="mono">${c.code}</b> ${c.name}</span></th>
      <td class="mono st-${c.status}">${statusWord(c)}</td><td>${density(c, true)}</td><td class="mono">${indexed(c)}</td><td class="mono">${fmtSync(c.sync)}</td>
      <td><button class="txt" data-act="scope" data-id="${c.id}" ${c.status === 'offline' ? 'disabled' : ''}>Search this camera</button></td></tr>`).join('')}</tbody></table>
    ${timeline()}` : ''}</section>`;
}

function memoryView() {
  return `<section class="page"><header class="page-h"><p class="eyebrow">VISUAL MEMORY</p><h1>What the system remembers.</h1>
    <p class="lede">Places defined once and resolved in every query that names them. ${memHere().length} referent${memHere().length === 1 ? '' : 's'} on these cameras.</p>
    <button class="btn" data-act="define">Define a referent</button></header>
    <ol class="refs">${memHere().map(r => { const c = cam(r.cameraId); return `<li class="ref-item">
      <figure>${frame(r.cameraId, { region: { rect: r.region, name: r.name }, time: hms(W[0]) })}</figure>
      <div><h2>${esc(r.name)}</h2><p class="mono dim">${c.code} · ${c.name} · saved region</p>
      <dl class="kv"><div><dt>Defined by</dt><dd>${esc(r.definedBy)}</dd></div><div><dt>Source</dt><dd>${c.code}</dd></div>
        <div><dt>Region</dt><dd class="mono">x ${r.region[0]} · y ${r.region[1]} · w ${r.region[2]} · h ${r.region[3]}</dd></div>
        <div><dt>Created</dt><dd>${fmtDate(r.created)}</dd></div><div><dt>Last used</dt><dd>${r.lastUsed ? fmtDate(r.lastUsed) : 'never'}</dd></div>
        <div><dt>Used in</dt><dd>${r.uses} search${r.uses === 1 ? '' : 'es'}</dd></div>${r.aliases?.length ? `<div><dt>Also called</dt><dd>${r.aliases.map(esc).join(', ')}</dd></div>` : ''}</dl>
      <div class="acts"><button class="txt" data-act="ask" data-q="What happened near the ${esc(r.name.toLowerCase())}?">Search here</button>
        <button class="txt" data-act="redefine" data-id="${r.id}">Redefine</button><button class="txt danger" data-act="forget" data-id="${r.id}">Forget</button></div></div></li>`; }).join('')}</ol></section>`;
}

// ---------- evidence board (§63) + multi-frame comparison (§55) ----------
const picked = new Set();
function boardCard(x) {
  const lanes = Object.entries(api.LANES);
  const body = x.kind === 'journey' ? (() => { const j = api.journey(x.track), s = j.sightings.map(ev);
    return `<div class="jstrip">${s.map(e => `<button data-act="open" data-id="${e.id}" aria-label="Open ${cam(e.cameraId).code} ${e.time}">${still(e, { crop: true })}</button>`).join('')}</div>
      <p class="t mono">JOURNEY · TRACK ${tid(x.track)}</p><p>${esc(ds().tracks[x.track])}</p>
      <p class="mono dim">${s.map(e => cam(e.cameraId).code).join(' → ')} · ${s[0].time.slice(0, 5)}–${s.at(-1).time.slice(0, 5)}</p>
      <button class="txt" data-act="follow" data-track="${x.track}">Open journey</button>`; })()
    : (() => { const e = ev(x.eventId), c = cam(e.cameraId);
    return `<button class="card-frame" data-act="open" data-id="${e.id}" aria-label="Open ${c.code} ${e.time}">${still(e)}</button>
      <p class="t mono">${c.code} · ${e.time} ${ds().TZ}</p><p>${esc(e.label)}</p>`; })();
  return `<li class="card ${x.expired ? 'expired' : ''}" draggable="true" data-card="${esc(x.id)}" data-lane-of="${x.lane}">
    ${x.expired ? `<p class="warn mono">EXPIRED · excluded from export</p>` : ''}${body}
    <p class="mono dim">from “${esc(x.query || 'archive')}”</p>
    <div class="card-ctl">
      <select data-move="${esc(x.id)}" aria-label="Move to lane">${lanes.map(([k, l]) => `<option value="${k}" ${x.lane === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="txt" data-act="nudge" data-id="${esc(x.id)}" data-d="-1" aria-label="Move earlier">↑</button><button class="txt" data-act="nudge" data-id="${esc(x.id)}" data-d="1" aria-label="Move later">↓</button>
      ${x.kind === 'event' ? `<label class="cmp"><input type="checkbox" data-pick="${x.eventId}" ${picked.has(x.eventId) ? 'checked' : ''}> Compare</label>` : ''}
      <button class="txt danger" data-act="unsave" data-id="${esc(x.id)}">Remove</button></div></li>`;
}

async function moveCard(id, lane, index) {
  await api.moveItem(id, lane, Math.max(0, index));
  S.saved = await api.getSaved(); render();
  $(`[data-card="${CSS.escape(id)}"] select`)?.focus();
}

function investigationView() {
  const exportable = S.saved.some(x => !x.expired && here(x));
  return `<section class="page"><header class="page-h"><p class="eyebrow">INVESTIGATION</p><h1>Evidence board.</h1>
    <p class="lede">${S.saved.length} item${S.saved.length === 1 ? '' : 's'} · ${S.history.length} searches. Drag cards between lanes, or use each card's lane menu and arrows. Stored ${mode === 'server' ? 'on the server' : 'in this browser'}.</p>
    <div class="acts">
      <button class="btn" data-act="compare-picked" ${picked.size < 2 ? 'disabled title="Tick Compare on two or more frames"' : ''}>Compare selected (${picked.size})</button>
      <button class="btn primary" data-act="export" ${!exportable || exportBlock() ? `disabled title="${exportBlock() ?? 'No unexpired evidence'}"` : ''}>Export evidence package</button></div></header>
    ${S.saved.length ? `<div class="board">${Object.entries(api.LANES).map(([k, l]) => { const items = S.saved.filter(x => x.lane === k && here(x));
      return `<section class="lane" data-lane="${k}" aria-label="${l}"><p class="eyebrow">${l} <span class="dim">${items.length}</span></p>
        <ol>${items.map(boardCard).join('')}</ol>${items.length ? '' : '<p class="drop-hint mono dim">Drop here</p>'}</section>`; }).join('')}</div>`
      : '<p class="dim">Nothing saved yet. Use “Save evidence” in any evidence view, or “Pin journey” on a journey.</p>'}
    <div class="nb"><section>
      <label class="eyebrow" for="notes">NOTES</label><textarea id="notes" rows="6">${esc(S.notes)}</textarea></section>
    <section><p class="eyebrow">HISTORY</p><ol class="hist">${S.history.map(h => `<li><button data-act="ask" data-q="${esc(h.text)}"><span>“${esc(h.text)}”</span>
      <span class="mono dim">${new Date(h.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} · ${STATUS[h.status]} · ${h.n} evidence event${h.n === 1 ? '' : 's'}</span></button></li>`).join('') || '<li class="dim">No searches yet.</li>'}</ol></section></div></section>`;
}

// ---------- referent resolver (inline for clarification, layer for memory) ----------
function resolver(R) {
  const c = R.cameraId && cam(R.cameraId);
  return `<section class="resolver" aria-labelledby="res-h">
    ${R.inline ? `<p class="verdict" tabindex="-1">ONE DETAIL NEEDED</p><h2 class="claim" id="res-h">I need one detail before I search. “${esc(R.term)}” has not been defined yet.</h2>
      <p class="lede">Select the camera that shows it, then drag over the area. It is saved once and resolved in every later query.</p>`
      : `<header class="ev-top"><p class="eyebrow">${R.id ? 'REDEFINE' : 'DEFINE'} VISUAL REFERENT</p><button class="txt" data-act="close">Close · Esc</button></header>
      <h2 class="claim" id="res-h">${R.id ? esc(R.name) : 'A place the system should remember'}</h2>`}
    <ol class="res-cams" aria-label="Choose camera">${cams.filter(x => x.status !== 'offline').map(x => `<li><button data-act="res-cam" data-id="${x.id}" aria-pressed="${R.cameraId === x.id}">
      ${frame(x.id, { time: hms(W[0]) })}<span class="mono">${x.code}</span> ${x.name}</button></li>`).join('')}</ol>
    ${c ? `<div class="res-draw"><p class="mono dim">${c.code} · ${c.name.toUpperCase()} · drag to select the area, or type the region</p>
      <div class="res-canvas" data-draw>${frame(c.id, { time: hms(W[0]) })}
        <svg class="res-ov" viewBox="0 0 640 360" preserveAspectRatio="none" aria-hidden="true"><rect id="res-rect" ${R.rect ? `x="${R.rect[0]}" y="${R.rect[1]}" width="${R.rect[2]}" height="${R.rect[3]}"` : ''}/></svg></div>
      <div class="res-form">
        <fieldset><legend class="mono">REGION (frame px)</legend>${['x', 'y', 'w', 'h'].map((k, i) => `<label class="mono">${k} <input type="number" min="0" max="${i % 2 ? 360 : 640}" data-xywh="${i}" value="${R.rect?.[i] ?? ''}"></label>`).join('')}</fieldset>
        <label class="res-name">Name <input id="res-name" value="${esc(R.name)}" required></label>
        <button class="btn primary" data-act="save-ref" ${R.rect?.[2] > 4 && R.rect?.[3] > 4 ? '' : 'disabled'}>Save referent</button></div></div>` : ''}
  </section>`;
}

function setRect(r) {
  S.resolver.rect = r;
  const el = $('#res-rect');
  if (el) ['x', 'y', 'width', 'height'].forEach((k, i) => el.setAttribute(k, r[i]));
  $$('[data-xywh]').forEach(inp => { if (inp !== document.activeElement) inp.value = r[inp.dataset.xywh]; });
  const b = $('[data-act=save-ref]');
  if (b) b.disabled = !(r[2] > 4 && r[3] > 4);
}

const openResolver = R => { S.resolver = { name: '', cameraId: null, rect: null, ...R, inline: false }; openLayer({ kind: 'resolver' }); };

async function saveRef() {
  const R = S.resolver, nm = $('#res-name').value.trim();
  if (!nm) return $('#res-name').focus();
  const aliases = R.term && !nm.toLowerCase().includes(R.term.toLowerCase()) ? [R.term] : undefined;
  if (R.id) await api.updateMemory(R.id, { name: nm, cameraId: R.cameraId, region: R.rect });
  else await api.createMemory({ name: nm, cameraId: R.cameraId, region: R.rect, aliases });
  S.memory = await api.getMemory();
  toast(`Remembered · ${nm.toUpperCase()} · ${cam(R.cameraId).code}`);
  S.resolver = null;
  if (dlg.open) dlg.close();
  R.inline ? run(S.query) : render();
}

// ---------- layer (single dialog: evidence, compare, passport, resolver, palette) ----------
const dlg = $('#layer');
const P = { off: 0, playing: false, speed: 1, box: true, trail: true, region: true };

function openLayer(L) {
  stopPlay();
  S.layer = L;
  dlg.className = 'layer ' + L.kind;
  dlg.innerHTML = LAYERS[L.kind](L);
  if (!dlg.open) dlg.showModal();
  if (L.kind === 'palette') { palFilter(); $('#pal-q').focus(); }
  else dlg.querySelector('h2, [data-act=close]')?.focus?.();
}
dlg.addEventListener('close', () => {
  stopPlay(); introTimers.forEach(clearTimeout); introTimers = [];
  S.layer = null; S.reveal = false; dlg.innerHTML = '';
});

const LAYERS = { sources: () => sourcesLayer(), setup: () => setupLayer(), intro: () => introLayer(), register: () => registerLayer(), video: L => videoLayer(L), diag: () => diagLayer(), evidence: evidenceLayer, compare: compareLayer, passport: passportLayer, resolver: () => resolver(S.resolver), palette: () => paletteLayer() };

function evidenceLayer({ id, off = 0, focus = false }) {
  const e = ev(id), c = cam(e.cameraId), q = S.res?.interp;
  const j = api.journey(e.track), i = j.sightings.indexOf(id), prev = ev(j.sightings[i - 1]), next = ev(j.sightings[i + 1]);
  P.off = off; P.id = id;
  P.ref = q?.location?.ref?.cameraId === c.id ? q.location.ref : S.memory.find(r => r.cameraId === c.id);
  const noun = e.entity === 'vehicle' ? 'vehicle' : 'person';
  return `<div class="ev ${focus ? 'focus' : ''}">
    <header class="ev-top"><nav class="crumbs mono" aria-label="Breadcrumb"><button class="txt" data-act="close">Search</button> / <span>${esc(S.query || 'Archive')}</span> / <b>Evidence</b></nav>
      <div><button class="txt" data-act="focusmode" aria-pressed="${focus}">Focus (F)</button> <button class="txt" data-act="close">Close · Esc</button></div></header>
    <div class="ev-body">
      <section class="ev-main" aria-label="Video evidence">
        <h2 class="sr-only">${esc(e.label)}, ${c.code}, ${e.time}</h2>
        <figure class="ev-frame" id="evf" style="view-transition-name: evidence">${e.clip ? `<video src="${esc(e.clip)}" controls preload="metadata"></video>` : evFrame()}</figure>
        ${e.clip ? '' : `<div class="player mono" role="group" aria-label="Playback">
          <button data-act="step" data-d="-0.5" aria-label="Back half a second">−0.5s</button>
          <button data-act="play" id="playbtn">Play</button>
          <button data-act="step" data-d="0.5" aria-label="Forward half a second">+0.5s</button>
          <input type="range" id="scrub" min="-8" max="8" step="0.25" value="${off}" aria-label="Scrub clip">
          <output id="tc">${hms(sec(e.time) + Math.round(off))}</output>
          <label>Speed <select id="speed">${[0.5, 1, 2].map(s => `<option ${s === P.speed ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          ${[['box', 'Box'], ['trail', 'Trajectory'], ['region', 'Region']].map(([k, l]) => `<label><input type="checkbox" data-tog="${k}" ${P[k] ? 'checked' : ''}> ${l}</label>`).join('')}
        </div>`}
        ${(() => { const offs = [-6, -4, -2, 0, 2, 4, 6], seen = offs.map(o => tracked(e, o));
          return `<section class="consist"><p class="eyebrow">TEMPORAL CONSISTENCY · TRACK ${tid(e.track)} · tracked in ${seen.filter(Boolean).length} of ${offs.length} sampled frames</p>
          <ol>${offs.map((o, i) => `<li><button data-act="seek" data-off="${o}" aria-label="Seek to ${o} seconds">${still(e, { offset: o, crop: seen[i] })}</button><span class="mono">${o > 0 ? '+' : ''}${o}s ${seen[i] ? '✓' : '·'}</span></li>`).join('')}</ol></section>`; })()}
      </section>
      <aside class="ev-side">
        <dl class="kv big"><div><dt>Camera</dt><dd>${c.name}<span class="mono dim"> ${c.code}</span></dd></div>
          <div><dt>Object</dt><dd>${esc(name(e))} <button class="txt mono" data-act="passport" data-track="${e.track}">Track ${tid(e.track)}</button></dd></div>
          <div><dt>Time</dt><dd class="mono">${e.time} ${ds().TZ}</dd></div></dl>
        ${evidenceStack(e, q)}${degradation(e)}
        <section><p class="eyebrow">ADJACENT SIGHTINGS</p><p>${prev ? `J ${evRef(prev)}` : '<span class="dim">No earlier sighting</span>'}</p><p>${next ? `L ${evRef(next)}` : '<span class="dim">No later sighting</span>'}</p></section>
        <div class="acts">
          <button class="btn primary" data-act="save" data-id="${id}">Save evidence</button>
          <button class="btn" data-act="follow" data-track="${e.track}">Follow this ${noun}</button>
          <button class="txt" data-act="exportone" data-id="${id}" ${exportBlock() ? `disabled title="${exportBlock()}"` : ''}>Export evidence</button>
          ${cam(e.cameraId).real ? `<button class="txt" data-act="play-orig" data-id="${e.vid ?? e.cameraId}" data-t="${e.vt ?? e.t}">Play with detections</button><button class="txt" data-act="play-orig" data-id="${e.vid ?? e.cameraId}" data-t="${e.vt ?? e.t}" data-det="0">Play original video</button><a class="txt" href="api/videos/${e.vid ?? e.cameraId}/file" download>Download source</a>`
            : '<button class="txt" disabled title="No source video in the demo">Download clip</button>'}
          ${maskable(e) ? `<button class="txt" data-act="reveal" data-id="${id}" ${S.settings.operator.role !== 'supervisor' && !S.reveal ? 'disabled title="Requires the supervisor role"' : ''}>${S.reveal ? 'Restore masking' : 'Reveal protected regions'}</button>` : ''}</div>
        ${S.reveal ? '<p class="warn mono">PROTECTED REGIONS REVEALED · this view is logged in the audit trail</p>' : ''}
      </aside>
    </div></div>`;
}

function evFrame() {
  const e = ev(P.id);
  return still(e, { offset: P.off, box: P.box, trail: P.trail, region: P.region && P.ref ? { rect: P.ref.region, name: P.ref.name } : null });
}
function drawFrame() {
  const f = $('#evf'); if (!f || ev(P.id).clip) return;
  f.innerHTML = evFrame();
  $('#scrub').value = P.off;
  $('#tc').value = hms(sec(ev(P.id).time) + Math.round(P.off));
}
function stopPlay() { P.playing = false; $('#playbtn') && ($('#playbtn').textContent = 'Play'); }
function togglePlay() {
  if (P.playing) return stopPlay();
  P.playing = true; $('#playbtn').textContent = 'Pause';
  if (P.off >= 8) P.off = -8;
  let last = performance.now();
  const loop = now => {
    if (!P.playing) return;
    P.off = Math.min(8, P.off + (now - last) / 1000 * P.speed); last = now;
    drawFrame();
    P.off >= 8 ? stopPlay() : requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
const stepBy = d => { stopPlay(); P.off = clamp(P.off + d, -8, 8); drawFrame(); };

function compareLayer({ ids, bridge }) {
  const close = '<button class="txt" data-act="close">Close · Esc</button>';
  if (!bridge) return `<header class="ev-top"><p class="eyebrow">COMPARISON · ${ids.length} candidate${ids.length > 1 ? 's' : ''}</p>${close}</header>
    <h2 class="sr-only">Candidate comparison</h2>${compareGrid(ids, S.res?.interp)}`;
  const [a, b] = ids.map(ev), t = api.journey(a.track).transitions.find(x => x.from === a.id && x.to === b.id);
  return `<header class="ev-top"><p class="eyebrow">TRANSITION · ${cam(a.cameraId).code} → ${cam(b.cameraId).code}</p>${close}</header>
    <h2 class="claim">${STRENGTH[t.strength]} <span class="mono dim">· ${dur(t.gap)} elapsed</span></h2>
    <div class="bridge">
      <figure>${still(a, { offset: 6 })}<figcaption class="mono">LAST FRAME · ${cam(a.cameraId).code} · ${hms(sec(a.time) + 6)}</figcaption><div class="crop">${still(a, { offset: 6, crop: true })}</div></figure>
      <div class="bridge-mid"><span class="mono">→ ${dur(t.gap)} →</span><ul class="checks">${t.reasons.map(tick).join('')}</ul>
        ${t.gaps.length ? `<p class="warn mono">Not observable in between: ${t.gaps.map(g => cam(g.cameraId).code).join(', ')}</p>` : ''}
        <p class="mono dim">Re-identification is an estimate, never a certainty.</p></div>
      <figure>${still(b, { offset: -6 })}<figcaption class="mono">FIRST FRAME · ${cam(b.cameraId).code} · ${hms(sec(b.time) - 6)}</figcaption><div class="crop">${still(b, { offset: -6, crop: true })}</div></figure>
    </div>`;
}

function passportLayer({ track }) {
  const o = api.object(track), s = o.sightings.map(ev), [a, z] = [s[0], s.at(-1)];
  return `<header class="ev-top"><p class="eyebrow">OBJECT PASSPORT</p><button class="txt" data-act="close">Close · Esc</button></header>
    <h2 class="claim">${esc(o.name)}</h2>
    <dl class="kv"><div><dt>Track</dt><dd class="mono">${tid(track)}</dd></div><div><dt>Type</dt><dd>${o.entity}</dd></div>
      <div><dt>First seen</dt><dd class="mono">${cam(a.cameraId).code} · ${a.time}</dd></div><div><dt>Last seen</dt><dd class="mono">${cam(z.cameraId).code} · ${z.time}</dd></div>
      <div><dt>Sightings</dt><dd>${s.length}</dd></div><div><dt>Cross-camera continuity</dt><dd>${o.transitions.length} transition${o.transitions.length === 1 ? '' : 's'}${o.transitions.length ? ' · ' + o.transitions.map(t => t.strength).join(', ') : ''}</dd></div></dl>
    <ol class="pp">${s.map(e => `<li><button data-act="open" data-id="${e.id}" aria-label="Open ${cam(e.cameraId).code} ${e.time}">${still(e, { crop: true })}</button><span class="mono">${cam(e.cameraId).code} · ${e.time}</span></li>`).join('')}</ol>
    ${maskable({ entity: o.entity }) && !S.reveal ? `<p class="mono dim">${o.entity === 'person' ? 'Faces' : 'Plates'} masked by privacy setting.</p>` : ''}
    <div class="acts"><button class="btn" data-act="follow" data-track="${track}">Open journey</button><button class="txt" data-act="pin-journey" data-track="${track}">Pin journey to board</button></div>`;
}

// ---------- local analysis setup (first launch prompt; System page) ----------
// The server installs ffmpeg, Ollama and the vision model (setup.mjs); the page just asks and shows progress.
let setupPoll = null;
const SETUP_PARTS = [
  ['ffmpeg', 'ffmpeg', 'Decodes your recordings, including H.265 CCTV files. About 100 MB.'],
  ['ollama', 'Ollama', 'Runs the vision model on this computer. About 1 GB.'],
  ['detector', 'Object detector', 'Finds and follows people and vehicles in every frame, so the vision model only describes each one once. Indexing becomes several times faster. YOLOX-S on ONNX Runtime, about 150 MB.'],
];

async function openSetup() {
  S.setup = await api.getSetup();
  openLayer({ kind: 'setup' });
  if (S.setup.job && !S.setup.job.finished) pollSetup();
}
const setupReady = s => s.ffmpeg.ok && s.ollama.running && s.model.ok && s.detector.ok;

function setupLayer() {
  const s = S.setup, j = s.job, running = j && !j.finished, model = S.setupModel ?? s.model.name;
  const known = Object.keys(s.models).includes(model);
  const mark = ok => `<span class="st" aria-hidden="true">${ok ? '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/><path d="m5 8.2 2 2 4-4.4"/></svg>' : '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7"/></svg>'}</span>`;
  const row = (name, note, ok, okText) => `<li class="${ok ? 'ok' : ''}">${mark(ok)}
    <div><p class="pn">${name} <span class="tag">${ok ? okText : 'Not installed'}</span></p><p class="pd">${note}</p></div></li>`;
  const modelOk = s.model.ok && s.model.name === model;
  return `<header class="ev-top"><p class="kicker">Local analysis</p><button class="txt" data-act="close">Close · Esc</button></header>
    <div class="setup">
      <h2 class="setup-title">Search your own recordings, privately.</h2>
      <p class="lede">Your footage is analysed on this computer by a local vision model. Nothing is uploaded. Downloads are checked against their published checksums, and nothing needs admin rights.</p>
      <ol class="parts">
        ${row(...SETUP_PARTS[0].slice(1), s.ffmpeg.ok, 'Installed')}
        ${row(...SETUP_PARTS[1].slice(1), s.ollama.installed, `Installed${s.ollama.version ? ' · version ' + s.ollama.version : ''}${s.ollama.running ? '' : ' · not running'}`)}
        ${row(...SETUP_PARTS[2].slice(1), s.detector.ok, 'Installed')}
        <li class="${modelOk ? 'ok' : ''}">${mark(modelOk)}<div>
          <p class="pn">Vision model <span class="tag">${modelOk ? model + ' · downloaded' : 'Choose one'}</span></p>
          <fieldset class="models" ${running ? 'disabled' : ''}><legend class="sr-only">Vision model</legend>
            ${Object.entries(s.models).map(([k, m], i) => `<label class="opt"><input type="radio" name="vmodel" value="${k}" ${model === k ? 'checked' : ''}>
              <span><span class="on">${k}<span class="size">${m.size}</span>${i === 0 ? '<span class="rec">Recommended</span>' : ''}</span><span class="pd">${m.note}</span></span></label>`).join('')}
            <label class="opt"><input type="radio" name="vmodel" value="custom" ${known ? '' : 'checked'}>
              <span><span class="on">Another Ollama model</span><span class="pd">For example one you have trained or imported yourself. It must accept images.</span>
              <input class="custom-model" name="custom" value="${known ? '' : esc(model)}" placeholder="name:tag" pattern="[\\w.\\-]+(/[\\w.\\-]+)*(:[\\w.\\-]+)?"></span></label>
          </fieldset></div></li>
      </ol>
      ${j ? `<ol class="progress" aria-live="polite">${j.steps.map(st => `<li class="${st.state}"><span>${esc(st.label)}</span>
        <span class="bar"><i style="width:${st.state === 'done' ? 100 : st.total ? st.done / st.total * 100 : 0}%"></i></span>
        <span class="mono dim">${st.total ? `${(st.done / 1048576).toFixed(0)} / ${(st.total / 1048576).toFixed(0)} MB` : st.state === 'running' ? 'working…' : ''}</span></li>`).join('')}</ol>
        ${j.error ? `<p class="warn">${esc(j.error)}</p>` : ''}` : ''}
      <div class="acts">${setupReady(s) && s.model.name === model ? `<button class="btn primary" data-act="close">Done</button>`
        : `<button class="btn primary" data-act="setup-install" ${running ? 'disabled' : ''}>${running ? 'Installing…' : j?.error ? 'Retry' : 'Install what is missing'}</button>
           ${running ? '' : '<button class="txt" data-act="setup-later">Not now</button>'}`}</div>
    </div>`;
}

async function startInstall() {
  const f = dlg.querySelector('.models'), pick = f.querySelector('[name=vmodel]:checked')?.value;
  const model = pick === 'custom' ? f.querySelector('[name=custom]').value.trim() : pick;
  if (!model) return toast('Enter an Ollama model name');
  try {
    S.settings = await api.setSettings({ vision: { model, setupSeen: true } });
    S.setupModel = model;
    const s = await api.getSetup();
    await api.installSetup({ ffmpeg: !s.ffmpeg.ok, ollama: !s.ollama.installed, model: s.model.ok && s.model.name === model ? null : model, detector: !s.detector.ok });
    pollSetup();
  } catch (e) { toast(e.message); }
}

function pollSetup() {
  clearTimeout(setupPoll);
  const tick = async () => {
    S.setup = await api.getSetup();
    if (S.layer?.kind === 'setup' && dlg.open) { const y = dlg.scrollTop; dlg.innerHTML = setupLayer(); dlg.scrollTop = y; }   // not openLayer: it refocuses the top
    if (S.setup.job && !S.setup.job.finished) setupPoll = setTimeout(tick, 700);
    else if (S.setup.job && !S.setup.job.error) toast('Local analysis is ready');
  };
  tick();
}

// ---------- opening sequence (§76). Scripted demonstration, labelled as such; skippable; static under reduced motion. ----------
let introTimers = [];
function introLayer() {
  const e = ev('ev_091412'), e2 = ev('ev_091548'), p = t => (sec(t) - W[0]) / (W[1] - W[0]) * 100;
  return `<div class="intro" data-step="0">
    <div class="intro-top"><p class="eyebrow">DEMONSTRATION · scripted sequence on demo footage, not a live search</p><button class="txt" data-act="close">Skip · Esc</button></div>
    <div class="intro-stage">
      <figure class="intro-a">${frame('cam_04', { time: '09:14:04' })}<div class="intro-hit">${still(e, { trail: true })}</div></figure>
      <svg class="intro-link" viewBox="0 0 100 4" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="2" x2="100" y2="2"/></svg>
      <figure class="intro-b">${still(e2)}</figure>
    </div>
    <p class="intro-q" id="intro-q" aria-live="polite"></p>
    <div class="intro-tl" aria-hidden="true">${cams.map(c => `<div class="${c.id === 'cam_04' ? 'keep' : ''}"><span class="mono">${c.code}</span><i>${allEvents.filter(x => x.cameraId === c.id)
      .map(x => `<b class="${x.id === e.id ? 'hit' : ''}" style="left:${p(x.time)}%"></b>`).join('')}</i></div>`).join('')}
      <span class="bracket" style="--l:${(p(e.time) - 3).toFixed(2)}"></span></div>
    <div class="intro-answer"><p class="verdict">SUPPORTED</p>
      <p class="claim">A red sedan entered through the Main Gate at 09:14:12 and was next seen at Parking at 09:15:48.</p>
      <div class="acts"><button class="btn primary" data-act="intro-try">Run this search for real</button><button class="txt" data-act="close">Go to the product</button></div></div>
  </div>`;
}
function playIntro() {
  openLayer({ kind: 'intro' });
  const root = $('.intro'), q = 'Find the red car entering the gate.', show = s => { $('#intro-q') && ($('#intro-q').textContent = s); };
  const at = (ms, fn) => introTimers.push(setTimeout(fn, ms));
  if (reduced.matches) { root.dataset.step = 5; return show(`“${q}”`); }
  at(500, () => root.dataset.step = 1);
  [...q].forEach((_, i) => at(700 + i * 30, () => show(`“${q.slice(0, i + 1)}`)));
  at(720 + q.length * 30, () => show(`“${q}”`));
  for (const [ms, step] of [[2100, 2], [2900, 3], [4000, 4], [5100, 5]]) at(ms, () => root.dataset.step = step);
}

// ---------- your recordings: upload + indexing (§116-118) ----------
// The server stores each upload; ffmpeg samples frames and the local vision model describes them (indexer.mjs).
const TZS = ['Asia/Kolkata', 'UTC', 'Europe/London', 'America/New_York', 'Asia/Singapore', 'Australia/Sydney'];
const mb = n => n < 1048576 ? Math.ceil(n / 1024) + ' KB' : (n / 1048576).toFixed(n < 1e8 ? 1 : 0) + ' MB';
const WORKING = ['queued', 'transcoding', 'extracting', 'analyzing', 'naming'];
const VSTATE = { queued: 'Queued', transcoding: 'Making a browser-playable copy', extracting: 'Extracting frames', analyzing: 'Analysing frames', naming: 'Describing each tracked object', ready: 'Indexed', failed: 'Failed' };
const localNow = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
let videoPoll = null;
const counted = (v, p) => v.status === 'analyzing' ? `${p.done} / ${p.total} frames` : v.status === 'naming' ? `${p.done} / ${p.total} objects` : `${dur(p.done)} of ${dur(p.total)}`;

function registerLayer() {
  const s = S.setup, ready = s && s.ffmpeg.ok && s.ollama.installed && s.model.ok;
  return `<header class="ev-top"><p class="eyebrow">ADD A RECORDING</p><button class="txt" data-act="close">Close · Esc</button></header>
    <h2 class="claim">Add recorded footage</h2>
    ${ready ? '' : `<p class="warn">Local analysis is not set up yet, so recordings cannot be indexed. <button class="txt" data-act="setup">Set it up</button></p>`}
    <form class="reg" data-form="register">
      <fieldset><legend class="eyebrow">FILES</legend>
        <label class="fld">Video files<input type="file" name="files" accept="video/*,.mkv,.avi,.ts,.mts,.m2ts,.dav,.h264,.h265,.hevc" multiple required></label>
        <p class="dim">Any format ffmpeg reads, including H.265 CCTV exports. Several files become one camera each, named after the file.</p></fieldset>
      <fieldset><legend class="eyebrow">CAMERA</legend>
        <label class="fld">Camera name<input name="name" maxlength="80" placeholder="Required for a single file"></label>
        <label class="fld">Location<input name="location" maxlength="120" placeholder="e.g. North entrance"></label>
        <label class="fld">Timezone<input name="tz" list="tzs" value="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}" required><datalist id="tzs">${TZS.map(t => `<option value="${t}">`).join('')}</datalist></label>
        <label class="fld">Recording started<input type="datetime-local" name="start" value="${localNow()}" step="1" required><span class="dim">Wall-clock time of the first frame, so results show real times</span></label></fieldset>
      ${S.videos.length ? `<fieldset><legend class="eyebrow">NEIGHBOURING CAMERAS · optional, improves journeys</legend>
        <div class="nbrs">${S.videos.map(v => `<label class="opt"><input type="checkbox" name="neighbors" value="${v.id}"><span>${esc(v.name)}</span></label>`).join('')}</div></fieldset>` : ''}
      <div class="acts"><button class="btn primary" ${ready ? '' : 'disabled'}>Upload and index</button></div>
      <div id="reg-progress" aria-live="polite"></div>
    </form>`;
}

async function uploadFootage(form) {
  const fd = new FormData(form), files = [...form.files.files], name = fd.get('name').trim(), prog = $('#reg-progress');
  if (files.length === 1 && !name) return form.name.focus(), toast('Name the camera');
  const start = new Date(fd.get('start'));
  if (Number.isNaN(+start)) return toast('Enter when the recording started');
  const meta = { location: fd.get('location').trim(), tz: fd.get('tz').trim(), start: start.toISOString(), neighbors: fd.getAll('neighbors').join(',') };
  form.querySelector('button.primary').disabled = true;
  let ok = 0;
  for (const f of files) {
    const nm = files.length === 1 ? name : f.name.replace(/\.[^.]+$/, '');
    try {
      await api.uploadVideo(f, { ...meta, name: nm }, (done, total) => {
        prog.innerHTML = `<div class="indexing"><p class="eyebrow">UPLOADING ${files.length > 1 ? `${ok + 1} OF ${files.length}` : ''}</p><p class="claim-s">${esc(nm)}</p>
          <div class="progress"><span class="bar"><i style="width:${total ? done / total * 100 : 0}%"></i></span></div><p class="mono dim">${mb(done)} / ${mb(total)}</p></div>`;
      });
      ok++;
    } catch (e) { toast(`${f.name}: ${e.message}`); }
  }
  form.querySelector('button.primary').disabled = false;
  if (!ok) return;
  toast(`${ok} recording${ok === 1 ? '' : 's'} added · indexing on this computer`);
  dlg.close(); go('cameras'); pollVideos();
}

function videosList() {
  if (!S.videos.length && !S.ingest?.feeds.length && !S.ingest?.imports.length) return `<section class="empty-footage"><p><b>No recordings yet.</b> Add your own recordings, capture public live cameras, or import an archive. Everything is analysed here by ${esc(S.settings.vision.model)} and never leaves this computer.</p>
    <div class="acts"><button class="btn primary" data-act="register">Add a recording</button><button class="btn" data-act="src-open" data-tab="tfl">Add live cameras</button><button class="btn" data-act="src-open" data-tab="meva">Import an archive</button></div></section>`;
  const groups = new Map();
  for (const v of S.videos) groups.set(v.cameraKey || v.id, [...(groups.get(v.cameraKey || v.id) || []), v]);
  return `${ingestPanel()}<section class="reg-list"><p class="eyebrow">RECORDINGS</p><ol>${[...groups.values()].map(vs => vs.length > 1 ? cameraClips(vs) : recordingRow(vs[0])).join('')}</ol></section>`;
}
// A live or archive camera: many clips, shown as one row with counts and the clip being indexed now.
function cameraClips(vs) {
  const ready = vs.filter(v => v.status === 'ready'), work = vs.find(v => WORKING.includes(v.status) && v.status !== 'queued'), failed = vs.filter(v => v.status === 'failed');
  const waiting = vs.filter(v => WORKING.includes(v.status)).length, latest = ready.at(-1), p = work?.progress || {};
  return `<li class="video-item ${work ? 'analyzing' : 'ready'}">
    <div class="vthumb">${latest ? `<img src="api/videos/${latest.id}/frames/1" alt="">` : '<span class="mono dim">no frames yet</span>'}</div>
    <div><h3>${esc(vs[0].name)}</h3><p class="mono dim">${esc(vs[0].location)} · ${esc(vs[0].tz)} · ${vs.length} clips · ${hmsDur(vs.reduce((n, v) => n + (v.duration || 0), 0))}</p>
      <p class="mono dim">${ready.length} indexed${waiting ? ` · ${waiting} waiting` : ''}${failed.length ? ` · ${failed.length} failed` : ''}${latest ? ` · latest ${new Date(latest.start).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: latest.tz })}` : ''}</p>
      ${work ? `<div class="vstate"><span class="mono">${VSTATE[work.status]}${p.total ? ` · ${counted(work, p)}` : ''}</span><span class="bar"><i style="width:${p.total ? Math.round(p.done / p.total * 100) : 0}%"></i></span></div>` : ''}
      ${failed.length ? `<p class="warn">${esc(failed.at(-1).error || 'Failed')}</p>` : ''}
      <div class="acts">${latest ? `<button class="txt" data-act="play-orig" data-id="${latest.id}" data-t="0">Play latest clip</button>` : ''}
        <button class="txt danger" data-act="camera-del" data-key="${esc(vs[0].cameraKey)}">Remove camera</button></div></div></li>`;
}
function recordingRow(v) {
  const p = v.progress || {}, pct = p.total ? Math.round(p.done / p.total * 100) : 0, working = WORKING.includes(v.status);
  return `<li class="video-item ${v.status}">
      <div class="vthumb">${['analyzing', 'naming', 'ready'].includes(v.status) ? `<img src="api/videos/${v.id}/frames/1" alt="">` : '<span class="mono dim">no frames yet</span>'}</div>
      <div><h3>${esc(v.name)}</h3><p class="mono dim">${esc(v.location)} · ${esc(v.tz)} · ${new Date(v.start).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium', timeZone: v.tz })}</p>
        <p class="mono dim">${v.width}×${v.height} · ${dur(Math.round(v.duration))} · ${mb(v.size)}${v.model ? ` · ${esc(v.model)} at ${v.sampling} fps` : ''}</p>
        <div class="vstate"><span class="mono">${VSTATE[v.status]}${working && p.total ? ` · ${counted(v, p)}` : ''}</span>
          ${working ? `<span class="bar"><i style="width:${pct}%"></i></span>` : ''}</div>
        ${v.error ? `<p class="warn">${esc(v.error)}</p>` : ''}
        ${v.status === 'ready' && v.skipped ? `<p class="dim">${v.skipped} frame${v.skipped === 1 ? '' : 's'} could not be analysed and ${v.skipped === 1 ? 'was' : 'were'} skipped.</p>` : ''}
        ${v.status === 'ready' && v.found === 0 ? '<p class="dim">No people, vehicles, animals or bags were found. The index only looks for these, so screen recordings usually have none.</p>' : ''}
        <div class="acts">${v.status === 'ready' ? `<button class="txt" data-act="play-orig" data-id="${v.id}" data-t="0">Play with detections</button><button class="txt" data-act="play-orig" data-id="${v.id}" data-t="0" data-det="0">Play original</button>` : ''}
          ${['ready', 'failed'].includes(v.status) ? `<button class="txt" data-act="video-reindex" data-id="${v.id}">Re-index</button>` : ''}
          <button class="txt danger" data-act="video-del" data-id="${v.id}">Remove</button></div></div></li>`;
}

// Poll while anything is indexing; refresh the dataset when a recording becomes searchable.
function pollVideos() {
  clearTimeout(videoPoll);
  const tick = async () => {
    const readyBefore = S.videos.filter(v => v.status === 'ready').length;
    [S.videos, S.ingest] = await Promise.all([api.getVideos(), api.getIngest()]);
    if (S.videos.filter(v => v.status === 'ready').length !== readyBefore && !ds().DEMO) { await loadDataset(); if (S.view !== 'cameras') render(); }
    if (S.view === 'cameras') $('#videos') ? ($('#videos').innerHTML = videosList()) : render();
    // keep polling while clips index, imports download, or live cameras capture
    if (S.videos.some(v => WORKING.includes(v.status)) || S.ingest.imports.some(i => ['queued', 'downloading'].includes(i.state)) || S.ingest.feeds.some(f => f.active)) videoPoll = setTimeout(tick, 3000);
    else if (S.view === 'cameras') render();
  };
  tick();
}

// ---------- public cameras and archives (sources.mjs) ----------
// Live cameras capture a clip every few minutes while the app is open; archives download clips. Everything is
// indexed by the same local model, so the backlog line says how long the queue will take at the measured speed.
const SRC = { tab: 'tfl', q: '', sel: new Map(), district: 7, list: [], loading: false, interval: 10, clipSec: 30, mevaPrefix: 'drops-123-r13/', meva: null, mevaSel: new Set() };
const TABS = [['tfl', 'London'], ['caltrans', 'California'], ['stream', 'Stream URL'], ['meva', 'MEVA archive'], ['urls', 'Video URLs']];
const hmsDur = s => s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round(s % 3600 / 60)} min` : s >= 60 ? `${Math.round(s / 60)} min` : `${Math.round(s)} s`;
const estimate = seconds => { const spf = S.ingest?.backlog?.secPerFrame; return spf ? hmsDur(seconds * S.settings.pipeline.sampling * spf) : null; };

async function openSources(tab) {
  SRC.tab = tab; SRC.q = ''; SRC.sel.clear();
  openLayer({ kind: 'sources' });
  await loadSourceList();
}
async function loadSourceList() {
  if (!['tfl', 'caltrans', 'meva'].includes(SRC.tab)) return;
  SRC.loading = true; drawSources();
  try {
    if (SRC.tab === 'tfl') SRC.list = await api.sourcesTfl();
    if (SRC.tab === 'caltrans') SRC.list = await api.sourcesCaltrans(SRC.district);
    if (SRC.tab === 'meva') { SRC.meva = await api.sourcesMeva(SRC.mevaPrefix); SRC.mevaSel.clear(); }
  } catch (e) { toast(e.message); }
  SRC.loading = false; drawSources();
}
const drawSources = () => { if (S.layer?.kind === 'sources' && dlg.open) { const y = dlg.scrollTop; dlg.innerHTML = sourcesLayer(); dlg.scrollTop = y; } };

function sourcesLayer() {
  const tab = SRC.tab, live = ['tfl', 'caltrans', 'stream'].includes(tab);
  return `<header class="ev-top"><p class="kicker">${live ? 'Add live cameras' : 'Import an archive'}</p><button class="txt" data-act="close">Close · Esc</button></header>
    <div class="tabs" role="tablist">${TABS.filter(([k]) => ['tfl', 'caltrans', 'stream'].includes(k) === live).map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-act="src-tab" data-tab="${k}">${l}</button>`).join('')}</div>
    <div class="srcbody">${{ tfl: pickCams, caltrans: pickCams, stream: streamForm, meva: mevaBrowser, urls: urlsForm }[tab]()}</div>`;
}

const intervalPick = () => `<label class="mono">Capture every <select data-src-interval>${[2, 5, 10, 15, 30, 60].map(m => `<option value="${m}" ${SRC.interval === m ? 'selected' : ''}>${m} min</option>`).join('')}</select></label>`;
function pickCams() {
  const tfl = SRC.tab === 'tfl', q = SRC.q.toLowerCase(), have = new Set((S.ingest?.feeds || []).map(f => f.url));
  const shown = SRC.list.filter(c => !q || `${c.name} ${c.view}`.toLowerCase().includes(q)).slice(0, 60);
  const perHour = SRC.sel.size * 60 / SRC.interval * (tfl ? 10 : SRC.clipSec);   // seconds of footage per hour
  return `<p class="dim">${tfl ? 'Transport for London JamCams: each camera publishes a 10-second clip that is replaced every few minutes. Only new clips are captured.'
      : 'Caltrans highway cameras stream live. Each capture records a short clip.'} Captures run while Video Intelligence is open.</p>
    <div class="src-controls">
      ${tfl ? '' : `<label class="mono">District <select data-src-district>${Object.entries({ 1: 'Eureka', 2: 'Redding', 3: 'Sacramento', 4: 'Bay Area', 5: 'San Luis Obispo', 6: 'Fresno', 7: 'Los Angeles', 8: 'San Bernardino', 9: 'Bishop', 10: 'Stockton', 11: 'San Diego', 12: 'Orange County' }).map(([d, n]) => `<option value="${d}" ${+d === SRC.district ? 'selected' : ''}>${d} · ${n}</option>`).join('')}</select></label>`}
      <input type="search" data-src-q value="${esc(SRC.q)}" placeholder="Search ${SRC.list.length || ''} cameras by road or place" aria-label="Search cameras">
    </div>
    ${SRC.loading ? '<p class="mono dim">Loading the camera list…</p>' : `<ol class="cam-grid">${shown.map(c => `<li><label class="cam-pick ${have.has(c.url) ? 'have' : ''}">
      <input type="checkbox" data-pick-cam="${esc(c.id)}" ${SRC.sel.has(c.id) || have.has(c.url) ? 'checked' : ''} ${have.has(c.url) ? 'disabled' : ''}>
      ${c.image ? `<img loading="lazy" src="${esc(c.image)}" alt="">` : '<span class="noimg"></span>'}
      <span class="cn">${esc(c.name)}</span><span class="mono dim">${esc(c.view || '')}${have.has(c.url) ? ' · added' : c.available === false ? ' · offline now' : ''}</span></label></li>`).join('')}</ol>
      ${SRC.list.length > shown.length ? `<p class="mono dim">Showing ${shown.length} of ${SRC.list.filter(c => !q || `${c.name} ${c.view}`.toLowerCase().includes(q)).length}. Search to narrow down.</p>` : ''}`}
    <div class="src-foot">
      ${intervalPick()}${tfl ? '' : `<label class="mono">Clip length <select data-src-clip>${[15, 30, 60, 120].map(s => `<option value="${s}" ${SRC.clipSec === s ? 'selected' : ''}>${s} s</option>`).join('')}</select></label>`}
      <button class="btn primary" data-act="src-add-cams" ${SRC.sel.size ? '' : 'disabled'}>Add ${SRC.sel.size || ''} camera${SRC.sel.size === 1 ? '' : 's'}</button>
      ${SRC.sel.size ? `<span class="dim">About ${hmsDur(perHour)} of footage an hour${estimate(perHour) ? `, which takes about ${estimate(perHour)} to index` : ''}.</span>` : ''}
    </div>
    <p class="attrib">${tfl ? 'Powered by TfL Open Data. Contains OS data © Crown copyright and database rights.' : 'Caltrans CCTV, California Department of Transportation.'}</p>`;
}
function streamForm() {
  return `<form class="reg" data-form="stream"><p class="dim">Any camera that publishes an HLS (.m3u8) or RTSP stream, or a short MP4 it keeps replacing. Each capture records one clip.</p>
    <label class="fld">Stream or clip URL<input name="url" required placeholder="https://…/playlist.m3u8 or rtsp://…" pattern="(https?|rtsp)://.+"></label>
    <label class="fld">Camera name<input name="name" required maxlength="80"></label>
    <label class="fld">Location<input name="location" maxlength="120"></label>
    <label class="fld">Timezone<input name="tz" list="tzs" value="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}" required><datalist id="tzs">${TZS.map(t => `<option value="${t}">`).join('')}</datalist></label>
    <div class="src-foot">${intervalPick()}<label class="mono">Clip length <select name="clipSec">${[15, 30, 60, 120].map(s => `<option ${s === 30 ? 'selected' : ''}>${s}</option>`).join('')}</select> s</label>
      <button class="btn primary">Add camera</button></div></form>`;
}
function mevaBrowser() {
  const m = SRC.meva, files = m?.files || [], sel = files.filter(f => SRC.mevaSel.has(f.key));
  const secs = f => { const [a, b] = [f.start, f.end].map(t => t.split(':').reduce((h, x) => h * 60 + +x, 0)); return Math.max(1, b - a); };
  const parts = SRC.mevaPrefix.split('/').filter(Boolean);
  return `<p class="dim">MEVA: about 330 hours of real multi-camera footage from one site (29 cameras, people and vehicles), in short clips. Pick a day and an hour, then clips.</p>
    <nav class="crumbs mono" aria-label="Folder">${parts.map((p, i) => `<button class="txt" data-act="meva-go" data-prefix="${esc(parts.slice(0, i + 1).join('/') + '/')}">${esc(p)}</button>`).join(' / ')}</nav>
    ${SRC.loading ? '<p class="mono dim">Listing…</p>' : `
    ${m?.dirs.length ? `<ol class="meva-dirs">${m.dirs.map(d => `<li><button class="btn" data-act="meva-go" data-prefix="${esc(d)}">${esc(d.split('/').filter(Boolean).pop())}</button></li>`).join('')}</ol>` : ''}
    ${files.length ? `<table class="events meva"><thead><tr><th scope="col"><input type="checkbox" data-meva-all ${sel.length === files.length ? 'checked' : ''} aria-label="Select all"></th><th scope="col">Camera</th><th scope="col">Site</th><th scope="col">Time</th><th scope="col">Size</th></tr></thead>
      <tbody>${files.map(f => `<tr><td><input type="checkbox" data-meva="${esc(f.key)}" ${SRC.mevaSel.has(f.key) ? 'checked' : ''} aria-label="${esc(f.camera)} ${f.start}"></td>
        <td class="mono">${esc(f.camera)}</td><td>${esc(f.site)}</td><td class="mono">${f.date} ${f.start}–${f.end}</td><td class="mono">${mb(f.size)}</td></tr>`).join('')}</tbody></table>` : ''}`}
    <div class="src-foot"><button class="btn primary" data-act="meva-import" ${sel.length ? '' : 'disabled'}>Import ${sel.length || ''} clip${sel.length === 1 ? '' : 's'}${sel.length ? ` · ${mb(sel.reduce((n, f) => n + f.size, 0))}` : ''}</button>
      ${sel.length ? `<span class="dim">${hmsDur(sel.reduce((n, f) => n + secs(f), 0))} of footage${estimate(sel.reduce((n, f) => n + secs(f), 0)) ? `, about ${estimate(sel.reduce((n, f) => n + secs(f), 0))} to index` : ''}. Clips of one camera become one camera.</span>` : ''}</div>
    <p class="attrib">MEVA dataset, Kitware / IARPA, CC BY 4.0. Muscatatuck Urban Training Center, Indiana.</p>`;
}
function urlsForm() {
  return `<form class="reg" data-form="urls"><p class="dim">Direct links to video files, one per line (for example a public dataset). Each file is downloaded and indexed here.</p>
    <label class="fld">Video URLs<textarea name="urls" rows="6" required placeholder="https://…/camera1.mp4"></textarea></label>
    <label class="fld">Camera name<input name="camera" maxlength="80" placeholder="Optional: put every file on one camera"></label>
    <label class="fld">Location<input name="location" maxlength="120"></label>
    <label class="fld">Timezone<input name="tz" list="tzs" value="${esc(Intl.DateTimeFormat().resolvedOptions().timeZone)}" required><datalist id="tzs">${TZS.map(t => `<option value="${t}">`).join('')}</datalist></label>
    <label class="fld">Recording started<input type="datetime-local" name="start" value="${localNow()}" step="1" required></label>
    <div class="src-foot"><button class="btn primary">Import</button></div></form>`;
}

async function addPickedCams() {
  const tfl = SRC.tab === 'tfl', tz = tfl ? 'Europe/London' : 'America/Los_Angeles';
  const items = SRC.list.filter(c => SRC.sel.has(c.id)).map(c => ({ name: c.name, location: tfl ? `${c.view ? c.view + ' · ' : ''}London` : `${c.view ? c.view + ' · ' : ''}California`, tz,
    url: c.url, kind: tfl ? 'clip' : 'stream', intervalMin: SRC.interval, clipSec: SRC.clipSec, provider: SRC.tab, image: c.image }));
  try { S.ingest = await api.addFeeds(items); toast(`${S.ingest.added} camera${S.ingest.added === 1 ? '' : 's'} added · first captures start now`); dlg.close(); go('cameras'); pollVideos(); }
  catch (e) { toast(e.message); }
}
async function submitStream(form) {
  const fd = new FormData(form), url = fd.get('url').trim();
  try {
    S.ingest = await api.addFeeds([{ name: fd.get('name').trim(), location: fd.get('location').trim(), tz: fd.get('tz').trim(), url, kind: /\.m3u8|^rtsp:/i.test(url) ? 'stream' : 'clip',
      intervalMin: SRC.interval, clipSec: +fd.get('clipSec'), provider: 'url' }]);
    toast('Camera added'); dlg.close(); go('cameras'); pollVideos();
  } catch (e) { toast(e.message); }
}
async function importMeva() {
  try { S.ingest = await api.addImports({ meva: SRC.meva.files.filter(f => SRC.mevaSel.has(f.key)).map(f => ({ key: f.key, size: f.size })) }); toast('Import started'); dlg.close(); go('cameras'); pollVideos(); }
  catch (e) { toast(e.message); }
}
async function submitUrls(form) {
  const fd = new FormData(form), urls = fd.get('urls').split(/\s+/).filter(Boolean);
  try {
    S.ingest = await api.addImports({ urls, camera: fd.get('camera').trim() || undefined, location: fd.get('location').trim() || undefined, tz: fd.get('tz').trim(), start: new Date(fd.get('start')).toISOString() });
    toast(`${urls.length} file${urls.length === 1 ? '' : 's'} queued for import`); dlg.close(); go('cameras'); pollVideos();
  } catch (e) { toast(e.message); }
}

// Cameras page: live cameras, imports and the indexing backlog, above the recordings (grouped per camera).
const FEED_KIND = { tfl: 'TfL JamCam · 10 s clips', caltrans: 'Caltrans live stream', url: 'Stream' };
function ingestPanel() {
  const ig = S.ingest; if (!ig) return '';
  const b = ig.backlog, active = ig.imports.filter(i => ['queued', 'downloading'].includes(i.state)), failed = ig.imports.filter(i => i.state === 'failed');
  return `${b.clips ? `<p class="backlog"><b>Indexing backlog</b> · ${b.clips} clip${b.clips === 1 ? '' : 's'} · ${hmsDur(b.seconds)} of footage${b.eta ? ` · up to ${hmsDur(b.eta)} at ${b.secPerFrame.toFixed(1)} s a frame (measured)` : ''}${b.clips >= ig.maxBacklog ? ' · live captures pause until it clears' : ''}</p>` : ''}
    ${ig.feeds.length ? `<section class="feeds"><p class="eyebrow">LIVE CAMERAS · capturing while the app is open</p><ol>${ig.feeds.map(f => `<li class="feed ${f.active ? '' : 'paused'}">
      ${f.image ? `<img loading="lazy" src="${esc(f.image)}" alt="">` : '<span class="noimg"></span>'}
      <div><p class="cn">${esc(f.name)}</p><p class="mono dim">${esc(FEED_KIND[f.provider] || 'Stream')} · every ${f.intervalMin} min · ${f.captures} capture${f.captures === 1 ? '' : 's'}</p>
        <p class="mono ${f.lastError ? 'warn' : 'dim'}">${f.active ? esc(f.state) : 'Paused'}${f.last ? ` · last ${new Date(f.last).toLocaleTimeString('en-GB')}` : ''}${f.lastError ? ` · ${esc(f.lastError)}` : ''}</p></div>
      <div class="acts"><button class="txt" data-act="feed-toggle" data-id="${f.id}" data-on="${f.active ? 0 : 1}">${f.active ? 'Pause' : 'Resume'}</button><button class="txt danger" data-act="feed-del" data-id="${f.id}">Remove</button></div></li>`).join('')}</ol>
      <p class="attrib">${[...new Set(ig.feeds.map(f => ig.attribution[f.provider]).filter(Boolean))].join(' ')}</p></section>` : ''}
    ${active.length || failed.length ? `<section class="imports"><p class="eyebrow">IMPORTS</p><ol>${[...active, ...failed].slice(0, 12).map(i => `<li><span>${esc(i.name)} <span class="mono dim">${esc(i.url.split('/').pop())}</span></span>
      <span class="mono ${i.state === 'failed' ? 'warn' : 'dim'}">${i.state === 'failed' ? esc(i.error) : i.state === 'downloading' ? `${mb(i.done)} / ${mb(i.total || 0)}` : 'queued'}</span></li>`).join('')}</ol>
      ${active.length > 12 ? `<p class="mono dim">and ${active.length - 12} more queued</p>` : ''}${failed.length ? '<button class="txt" data-act="imports-clear">Clear finished</button>' : ''}</section>` : ''}`;
}

// Playback of a recording, with the indexed tracks drawn over it (or the original picture alone).
const V = { evs: [], det: true, gap: 2 };
function videoLayer({ id, t = 0, det = true }) {
  const c = cam(id) ?? S.videos.find(v => v.id === id), sv = S.videos.find(v => v.id === id);
  V.evs = allEvents.filter(e => (e.vid ?? e.cameraId) === id && e.dets?.length);   // this clip's tracks
  V.det = det && V.evs.length > 0; V.gap = 1 / (sv?.sampling || 0.5);
  const seg = ([m, l]) => `<button data-act="vmode" data-m="${m}" aria-pressed="${(m === 'det') === V.det}" ${m === 'det' && !V.evs.length ? 'disabled title="Not indexed yet"' : ''}>${l}</button>`;
  cancelAnimationFrame(V.raf); V.t = null; V.raf = requestAnimationFrame(drawBoxes);
  return `<header class="ev-top"><p class="eyebrow">RECORDING · ${esc(c.name)}</p>
      <div><span class="mode" role="group" aria-label="Playback">${[['det', 'With detections'], ['orig', 'Original']].map(seg).join('')}</span>
      <button class="txt" data-act="close">Close · Esc</button></div></header>
    <h2 class="sr-only">${esc(c.name)} recording</h2>
    <div class="vplay" style="--ar:${c.width || 16}/${c.height || 9}">
      <video id="vplay" src="api/videos/${id}/play#t=${Math.max(0, +t - 3)}" controls autoplay muted playsinline
        onerror="this.parentNode.outerHTML='<p class=&quot;warn&quot;>This recording cannot be played. Re-index it to make a browser-playable copy.</p>'"></video>
      <div id="vbox" aria-hidden="true">${V.evs.map(e => `<div class="vb ${e.entity}" hidden><span>${tid(e.track)} · ${esc(e.label)}</span></div>`).join('')}</div></div>
    <p class="mono dim">${V.evs.length ? `${V.evs.length} tracked object${V.evs.length === 1 ? '' : 's'} · boxes are interpolated between frames sampled every ${V.gap}s. ` : ''}Privacy masks apply to extracted frames only, not to playback.</p>`;
}
// Box at time t: interpolated inside the track, held for half a sampling interval at either end.
function boxAt(ds, t) {
  if (t < ds[0].t - V.gap / 2 || t > ds.at(-1).t + V.gap / 2) return null;
  const i = ds.findIndex(d => d.t > t);
  if (i <= 0) return (i ? ds.at(-1) : ds[0]).box;
  const [a, b] = [ds[i - 1], ds[i]], k = (t - a.t) / (b.t - a.t);
  return a.box.map((n, j) => n + (b.box[j] - n) * k);
}
function drawBoxes() {
  const v = $('#vplay'), box = $('#vbox');
  if (!v || !box || !dlg.open) return;
  V.raf = requestAnimationFrame(drawBoxes);
  const t = V.det ? v.currentTime : -1;
  if (t === V.t) return;   // paused or between video frames: nothing moved
  V.t = t;
  // dets are in camera time; a live/archive camera's clip starts e.t - e.vt seconds into it
  [...box.children].forEach((n, i) => {
    const e = V.evs[i], b = t >= 0 && boxAt(e.dets, t + (e.vt != null ? e.t - e.vt : 0));
    n.hidden = !b;
    if (b) n.style.cssText = `left:${b[0] / 6.4}%;top:${b[1] / 3.6}%;width:${b[2] / 6.4}%;height:${b[3] / 3.6}%`;
  });
}

async function loadDataset() {
  const d = await api.getDataset();
  api.useDataset(d);
  cams = d.cameras; allEvents = d.events;
}

// Your footage is searched one day at a time (an archive and today's live captures do not share a time axis).
const clearSearch = () => { S.abort?.abort(); Object.assign(S, { phase: 'idle', res: null, interp: null, stages: [], context: null, scope: 'all', zoom: 0 }); };
async function switchDay(day) {
  S.settings = await api.setSettings({ day });
  await loadDataset();
  clearSearch();
  render(); toast(`Showing footage from ${new Date(day + 'T12:00Z').toLocaleDateString('en-GB', { dateStyle: 'medium' })}`);
}

async function switchSource(src) {
  if (mode !== 'server' || (src === 'mine') === !ds().DEMO) return;
  S.settings = await api.setSettings({ source: src });
  await loadDataset();
  S.live.ac?.abort();
  Object.assign(S.live, { t: W[0], feed: [], streams: {}, done: false, lastAt: null });
  Object.assign(S, { phase: 'idle', res: null, interp: null, stages: [], context: null, scope: 'all', query: '', zoom: 0 });
  if (src === 'mine') { S.videos = await api.getVideos(); S.setup = await api.getSetup(); pollVideos(); }
  render();
}

// ---------- live (§32), standing queries (§33), alerts (§34) ----------
// Simulated: replays the recorded hour. Labelled as such everywhere; nothing here claims to be happening now.
function liveView() {
  const L = S.live;
  return `<section class="page"><header class="page-h"><p class="eyebrow">LIVE · SIMULATED</p><h1>Watching the replay.</h1>
    <p class="lede">No live ingest is connected. This replays the indexed footage through the same detection and standing-query path a live stream would use. Nothing shown here is happening now.</p></header>
    <div class="live-bar">
      <div><p class="eyebrow">REPLAY CLOCK</p><div id="live-clock">${liveClock()}</div></div>
      <div class="acts">
        <button class="btn primary" data-act="live-toggle">${L.running ? 'Pause' : L.done ? 'Replay again' : L.t > W[0] ? 'Resume' : 'Start replay'}</button>
        <label class="mono">SPEED <select id="live-speed">${[30, 60, 120, 300].map(s => `<option value="${s}" ${L.speed === s ? 'selected' : ''}>${s}×</option>`).join('')}</select></label>
        ${L.t > W[0] && !L.running ? `<button class="txt" data-act="live-reset">Reset to ${hm(W[0])}</button>` : ''}</div>
    </div>
    <div class="live-grid">
      <section><p class="eyebrow">STREAMS</p><ul id="live-cams" class="live-cams">${liveCams()}</ul></section>
      <section><p class="eyebrow">DETECTIONS</p><ol id="live-feed" class="live-feed">${liveFeed()}</ol></section>
    </div>
    <div class="live-grid">
      <section><p class="eyebrow">STANDING QUERIES</p><ol class="watches" id="live-watches">${watchesList()}</ol>${watchForm()}</section>
      <section><p class="eyebrow">ALERTS</p><ol id="live-alerts" class="alerts">${alertsList()}</ol></section>
    </div></section>`;
}

const liveClock = () => {
  const L = S.live, ago = L.lastAt ? Math.round((Date.now() - L.lastAt) / 1000) : null;
  return `<p class="live-clock mono">${hms(L.t)} <span class="dim">${ds().TZ}</span></p>
    <p class="mono dim">${L.running ? `INDEXING · up to ${hms(L.t)}` : L.done ? 'REPLAY COMPLETE · INDEX COMPLETE' : L.t > W[0] ? 'PAUSED' : 'READY'}${ago != null ? ` · last detection ${ago}s ago (wall clock)` : ''}</p>`;
};
const liveCams = () => cams.map(c => {
  const st = S.live.streams[c.id] ?? api.streamState(c, S.live.t), last = S.live.feed.find(f => ev(f.id).cameraId === c.id);
  return `<li class="${st === 'STREAMING' ? '' : 'nosig'}"><b class="mono">${c.code}</b><span>${c.name}</span><span class="mono">${st}</span><span class="mono dim">${last ? ev(last.id).time : '—'}</span></li>`;
}).join('');
const liveFeed = () => S.live.feed.map(f => { const e = ev(f.id);
  return `<li><button class="thumb" data-act="open" data-id="${e.id}" aria-label="Open ${e.time}">${still(e, { crop: true })}</button>
    <div><p class="mono">${e.time} · ${cam(e.cameraId).code}</p><p>${esc(e.label)}</p><p class="mono dim">watch evaluation ${f.evalMs} ms${f.watches.length ? ' · <span class="warn">ALERT</span>' : ''}</p></div></li>`;
}).join('') || '<li class="dim">No detections yet in this replay.</li>';
function watchState(w) {
  const q = api.interpret(w.text, S.memory, null);
  if (q.location && !q.location.ref) return ['NEEDS REFERENT', q.location.term];
  return [w.status === 'paused' ? 'PAUSED' : api.inSchedule(S.live.t, w) ? 'IN SCHEDULE' : 'OUT OF SCHEDULE'];
}
const watchesList = () => S.watches.map(w => { const [st, term] = watchState(w), hits = S.alerts.filter(a => a.watchId === w.id).length;
  return `<li class="watch"><p class="wq">“${esc(w.text)}”</p><dl class="kv">
    <div><dt>Status</dt><dd class="mono">${w.status.toUpperCase()} · ${st}</dd></div><div><dt>Scope</dt><dd>${w.scope === 'all' ? 'All cameras' : cam(w.scope) ? cam(w.scope).code + ' · ' + cam(w.scope).name : `<span class="dim">${esc(w.scope)} · not in this footage</span>`}</dd></div>
    <div><dt>Schedule</dt><dd class="mono">${w.from} → ${w.to}${sec(w.from + ':00') > sec(w.to + ':00') ? ' (overnight)' : ''}</dd></div><div><dt>Alerts</dt><dd>${hits}</dd></div></dl>
    <div class="acts"><button class="txt" data-act="watch-toggle" data-id="${w.id}">${w.status === 'active' ? 'Pause' : 'Resume'}</button>
    ${term ? `<button class="txt" data-act="define-term" data-term="${esc(term)}">Define “${esc(term)}”</button>` : ''}<button class="txt danger" data-act="watch-del" data-id="${w.id}">Delete</button></div></li>`;
}).join('') || '<li class="dim">No standing queries.</li>';
const watchForm = () => `<form class="watch-form" data-form="watch"><p class="eyebrow">NEW STANDING QUERY</p>
  <label class="fld">Watch for<input name="text" required maxlength="300" placeholder="Anyone entering the rear entrance"></label>
  <label class="fld">Cameras<select name="scope"><option value="all">All cameras</option>${cams.map(c => `<option value="${c.id}">${c.code} · ${c.name}</option>`).join('')}</select></label>
  <label class="fld">Active from<input type="time" name="from" value="20:00" required></label>
  <label class="fld">Until<input type="time" name="to" value="06:00" required></label>
  <div class="acts"><button class="btn">Save standing query</button><span class="dim">Applies from the next replay start.</span></div></form>`;
const alertsList = () => S.alerts.filter(a => ev(a.eventId)).map(a => { const e = ev(a.eventId);
  return `<li><p class="eyebrow warn">NEW EVENT · ${esc(cam(e.cameraId).name.toUpperCase())}</p><p class="mono">${e.time} ${ds().TZ}</p><p>${esc(e.label)}</p>
    <p class="mono dim">Watch: “${esc(a.watchText)}”</p><button class="txt" data-act="open" data-id="${e.id}">View evidence</button></li>`;
}).join('') || '<li class="dim">No alerts.</li>';

function liveUpdate() {
  for (const [id, fn] of [['live-clock', liveClock], ['live-cams', liveCams], ['live-feed', liveFeed], ['live-alerts', alertsList], ['live-watches', watchesList]]) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = fn();
  }
}

async function liveStart() {
  const L = S.live;
  if (L.done) Object.assign(L, { t: W[0], feed: [], streams: {}, done: false, lastAt: null });
  L.ac = new AbortController(); L.running = true; render();
  try {
    await api.live({ speed: L.speed, from: L.t, signal: L.ac.signal,
      onTick: d => { L.t = d.t; L.streams = d.streams; liveUpdate(); },
      onEvent: d => { L.feed.unshift(d); L.feed.length = Math.min(L.feed.length, 30); L.lastAt = Date.now(); liveUpdate(); },
      onAlert: a => { S.alerts.unshift(a); notify(a); liveUpdate(); } });
    L.done = true;
  } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
  L.running = false;
  render();
}

function notify(a) {
  const e = ev(a.eventId), t = document.createElement('div');
  t.className = 'alert-toast';
  t.innerHTML = `<p class="eyebrow warn">NEW EVENT · ${esc(cam(e.cameraId).name.toUpperCase())} · ${e.time}</p><p>${esc(e.label)}</p>
    <p class="mono dim">“${esc(a.watchText)}”</p><button class="txt" data-act="open" data-id="${e.id}">View evidence</button>`;
  $('#toasts').append(t); setTimeout(() => t.remove(), 9000);
}

async function saveWatch(form) {
  const fd = new FormData(form);
  try {
    await api.createWatch({ text: fd.get('text').trim(), scope: fd.get('scope'), from: fd.get('from'), to: fd.get('to') });
    S.watches = await api.getWatches(); toast('Standing query saved'); render();
  } catch (e) { toast(e.message); }
}

// ---------- diagnostics (§66, §120, §121, §154) ----------
function diagLayer() {
  const r = S.res, d = r.diag, q = r.interp;
  const role = id => r.primary === id ? 'PRIMARY' : r.candidates?.includes(id) ? 'CANDIDATE' : r.events?.includes(id) ? 'MATCHED'
    : r.journey?.sightings.includes(id) ? 'SIGHTING' : r.alternatives?.includes(id) ? 'ALTERNATIVE' : r.rejected.some(x => x.id === id) ? 'REJECTED' : 'FILTERED';
  const lat = r.funnel.map((s, i) => [STAGES.find(x => x[0] === s.stage)?.[1] ?? s.stage, s.count, s.ms - (r.funnel[i - 1]?.ms ?? 0)]);
  const tracksHit = [...new Set([r.primary, ...(r.candidates || []), ...(r.events || [])].filter(Boolean).map(id => ev(id).track))];
  const tier = (name, done) => `<div><dt>${name}</dt><dd class="mono">${done}</dd></div>`;
  return `<header class="ev-top"><p class="eyebrow">SEARCH DIAGNOSTICS</p><button class="txt" data-act="close">Close · Esc</button></header>
    <h2 class="claim">${STATUS[r.status]} <span class="mono dim">· ${api.DEPTHS[d.depth].label} search · ${r.ms} ms</span></h2>
    <div class="diag-grid">
      <section><p class="eyebrow">QUERY</p><dl class="kv">
        <div><dt>Text</dt><dd>${esc(q.text)}</dd></div>
        <div><dt>Interpretation</dt><dd class="mono">${esc(JSON.stringify({ entity: q.entity, attrs: q.attrs, location: q.location?.term ?? null, intent: q.intent, crossing: q.crossing, follow: q.follow?.track ?? null }))}</dd></div>
        <div><dt>Window</dt><dd class="mono">${hm(r.window[0])} → ${hm(r.window[1])} ${ds().TZ}</dd></div>
        <div><dt>Pipeline</dt><dd class="mono">${Object.entries(d.pipeline).map(([k, v]) => `${k}=${esc(v)}`).join(' · ')}</dd></div></dl></section>
      <section><p class="eyebrow">SEARCH COST</p><dl class="kv">
        ${tier('FAST · broad retrieval', 'Complete')}${tier('PRECISE · temporal + spatial grounding', 'Complete')}${tier('DEEP · cross-camera validation', d.cross ? 'Complete' : 'Skipped (fast mode)')}</dl></section>
      <section class="wide"><p class="eyebrow">RETRIEVAL · TOP-${d.topK === 999 ? 'ALL' : d.topK} CANDIDATES</p>
        ${d.retrieved.length ? `<table><thead><tr><th scope="col">#</th><th scope="col">Event</th><th scope="col">Camera · time</th><th scope="col">Score</th><th scope="col">Outcome</th></tr></thead>
        <tbody>${d.retrieved.map((x, i) => { const e = ev(x.id); return `<tr><td class="mono">${i + 1}</td><td><button class="txt" data-act="open" data-id="${e.id}">${esc(e.label)}</button></td>
          <td class="mono">${cam(e.cameraId).code} · ${e.time}</td><td class="mono">${x.score.toFixed(3)}</td><td class="mono">${role(x.id)}</td></tr>`; }).join('')}</tbody></table>` : '<p class="dim">No candidates retrieved.</p>'}</section>
      <section><p class="eyebrow">GROUNDING</p><dl class="kv">
        <div><dt>Temporal</dt><dd class="mono">${r.primary ? `${hms(sec(ev(r.primary).time) - 8)} → ${hms(sec(ev(r.primary).time) + 8)}` : `${hm(r.window[0])} → ${hm(r.window[1])}`}</dd></div>
        <div><dt>Spatial</dt><dd>${q.location?.ref ? `${esc(q.location.ref.name)} · ${cam(q.location.ref.cameraId).code} region` : 'No region constraint'}</dd></div>
        <div><dt>Object tracks</dt><dd class="mono">${tracksHit.join(', ') || (r.journey ? r.journey.track : '—')}</dd></div>
        <div><dt>Cross-camera</dt><dd>${!d.cross ? 'Not checked' : r.journey ? r.journey.transitions.map(t => t.strength).join(', ') || 'single sighting' : 'n/a'}</dd></div></dl></section>
      <section><p class="eyebrow">LATENCY <span class="dim">· measured, includes demo stage delay</span></p>
        <ol class="lat">${lat.map(([n, c, dt]) => `<li><span>${n}</span><span class="mono">${c ?? '—'}</span><span class="bar"><i style="width:${dt / r.ms * 100}%"></i></span><span class="mono">${dt} ms</span></li>`).join('')}
        <li class="tot"><span>Total</span><span></span><span></span><span class="mono">${r.ms} ms</span></li></ol></section>
    </div>`;
}

// ---------- system (§64, §65, §67, §119) ----------
function systemView() {
  const covered = c => c.coverage.reduce((n, [a, b]) => n + Math.min(sec(b), W[1]) - Math.max(sec(a), W[0]), 0) / (W[1] - W[0]);
  const avail = cams.filter(c => c.status !== 'offline'), p = S.settings.pipeline;
  return `<section class="page"><header class="page-h"><p class="eyebrow">SYSTEM</p><h1>How the index stands.</h1>
    <p class="lede">Search quality depends on what was indexed. Values are computed from the ${mode === 'server' ? 'server' : 'in-browser'} demo index.</p></header>
    <section class="health" aria-label="System health"><dl class="kv">
      <div><dt>Cameras</dt><dd>${avail.length} / ${cams.length} available</dd></div>
      <div><dt>Index</dt><dd>Complete for available footage</dd></div>
      <div><dt>Events</dt><dd>${allEvents.length} indexed</dd></div>
      <div><dt>Tracks</dt><dd>${new Set(allEvents.map(e => e.track)).size} indexed</dd></div>
      <div><dt>Memory</dt><dd>${S.memory.length} referents · ${mode}</dd></div></dl></section>
    <section><p class="eyebrow">INDEX COVERAGE &amp; SYNC</p>
      <table class="sys-t"><thead><tr><th scope="col">Camera</th><th scope="col">Coverage</th><th scope="col">Frames</th><th scope="col">Embeddings</th><th scope="col">Events</th><th scope="col">Clock offset</th><th scope="col">Failed segments</th></tr></thead>
      <tbody>${cams.map(c => { const v = c.status === 'offline' ? 0 : covered(c), pct = Math.round(v * 100) + '%', holes = api.coverageGaps([{ ...c, status: 'ready' }], W);
        return `<tr><th scope="row" class="mono">${c.code} <span class="dim">${c.name}</span></th><td><span class="meter" role="img" aria-label="${pct} covered"><i style="width:${v * 100}%"></i></span> <span class="mono">${pct}</span></td>
          <td class="mono">${pct}</td><td class="mono">${pct}</td><td class="mono">${allEvents.filter(e => e.cameraId === c.id).length}</td>
          <td class="mono">${fmtSync(c.sync)}${c.sync != null && Math.abs(c.sync) > 1 ? ' <span class="warn">DRIFT</span>' : ''}</td>
          <td class="mono">${c.status === 'offline' ? 'camera offline' : holes.map(g => hm(g.from) + '–' + hm(g.to)).join(', ') || 'none'}</td></tr>`; }).join('')}</tbody></table></section>
    <form class="settings" data-form="settings">
      <fieldset><legend class="eyebrow">DEFAULT SEARCH DEPTH</legend>
        ${Object.entries(api.DEPTHS).map(([k, d]) => `<label class="opt"><input type="radio" name="depth" value="${k}" ${S.settings.depth === k ? 'checked' : ''}><span><b>${d.label}</b> ${d.note}</span></label>`).join('')}</fieldset>
      <fieldset><legend class="eyebrow">PIPELINE <span class="dim">· applies to recordings indexed from now on</span></legend>
        <p class="dim">Vision model: <b class="mono">${esc(S.settings.vision.model)}</b> via Ollama. <button type="button" class="txt" data-act="setup">Change or install</button></p>
        <label class="fld">Frames analysed per second<input name="sampling" type="number" min="0.1" max="30" step="0.1" value="${p.sampling}" required></label>
        <label class="fld">Temporal refinement window (± s)<input name="refinement" type="number" min="0" max="30" step="1" value="${p.refinement}" required></label></fieldset>
      <fieldset><legend class="eyebrow">PRIVACY</legend>
        ${ds().DEMO ? '' : '<p class="dim">On your recordings, masks cover the faces and plates the vision model reports. It can miss some, so treat masking as best effort.</p>'}
        ${[['faces', 'Blur faces'], ['plates', 'Blur licence plates'], ['onPrem', 'On-premises inference only (recorded with every search)']].map(([k, l]) => `<label class="opt"><input type="checkbox" name="${k}" ${S.settings.privacy[k] ? 'checked' : ''}><span>${l}</span></label>`).join('')}
        <label class="fld">Search history retention (days)<input name="retentionDays" type="number" min="1" max="3650" step="1" value="${S.settings.privacy.retentionDays}" required></label>
        <label class="fld">Saved evidence expires after (days)<input name="expiryDays" type="number" min="1" max="3650" step="1" value="${S.settings.privacy.expiryDays}" required></label>
        <label class="fld">Evidence export<select name="exports">${Object.entries(api.EXPORTS).map(([k, l]) => `<option value="${k}" ${S.settings.privacy.exports === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label></fieldset>
      <fieldset><legend class="eyebrow">OPERATOR <span class="dim">· the demo has no sign-in, so the role is a setting</span></legend>
        <label class="fld">Role<select name="role">${api.ROLES.map(r => `<option ${S.settings.operator.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
        <p class="dim">Viewers cannot export. Only supervisors can reveal masked regions, and every reveal is logged.</p></fieldset>
      <div class="acts"><button class="btn primary">Save settings</button>${S.res ? '<button type="button" class="txt" data-act="diag">Last search diagnostics</button>' : ''}</div>
    </form>
    ${mode === 'server' ? `<section class="local"><p class="kicker">Local analysis</p><p class="dim">Vision model <b class="mono">${esc(S.settings.vision.model)}</b> via Ollama, with ffmpeg for decoding.</p>
      <div class="acts"><button class="btn" data-act="setup">Check or install components</button></div></section>` : ''}
    <section class="audit"><p class="eyebrow">AUDIT TRAIL</p>${S.audit.some(a => ev(a.eventId)) ? `<ol>${S.audit.filter(a => ev(a.eventId)).map(a => `<li class="mono"><span>${new Date(a.at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'medium' })}</span><span>${a.action.toUpperCase()}</span><span>${a.role}</span><button class="txt" data-act="open" data-id="${a.eventId}">${cam(ev(a.eventId).cameraId).code} · ${ev(a.eventId).time}</button></li>`).join('')}</ol>` : '<p class="dim">No protected regions have been revealed.</p>'}</section>
  </section>`;
}

async function saveSettings(form) {
  const fd = new FormData(form);
  const pipeline = { sampling: +fd.get('sampling'), refinement: +fd.get('refinement') };
  const privacy = { faces: fd.has('faces'), plates: fd.has('plates'), onPrem: fd.has('onPrem'), retentionDays: +fd.get('retentionDays'), expiryDays: +fd.get('expiryDays'), exports: fd.get('exports') };
  try {
    S.settings = await api.setSettings({ depth: fd.get('depth'), pipeline, privacy, operator: { role: fd.get('role') } });
    S.depth = null; [S.history, S.saved] = await Promise.all([api.getHistory(), api.getSaved()]);
    toast('Settings saved'); render();
  } catch (e) { toast(e.message); }
}

async function togglePrivacy() {
  const on = S.settings.privacy.faces || S.settings.privacy.plates;
  S.settings = await api.setSettings({ privacy: { faces: !on, plates: !on } });
  render(); toast(`Privacy masking ${on ? 'off' : 'on'}`);
}

async function reveal(id) {
  if (S.reveal) { S.reveal = false; return openLayer({ ...S.layer, off: P.off }); }
  try {
    await api.addAudit({ action: 'reveal', eventId: id });
    S.reveal = true; S.audit = await api.getAudit();
    openLayer({ ...S.layer, off: P.off }); toast('Protected regions revealed · logged');
  } catch (e) { toast(e.message); }
}

// ---------- command palette ----------
const PAL = { items: [], i: 0 };
const commands = () => [
  ['Search footage', () => go('search', focusQ)],
  ['Open cameras', () => go('cameras')], ['Open visual memory', () => go('memory')], ['Open investigation', () => go('investigation')],
  ...(S.res?.primary ? [['Open primary evidence', () => openEvidence(S.res.primary)]] : []),
  ...(S.res?.candidates ? [['Compare candidates', () => openLayer({ kind: 'compare', ids: S.res.candidates })]] : []),
  ...(S.context ? [[`Open journey · ${ds().tracks[S.context.track]}`, () => follow(S.context.track)]] : []),
  ['Define a visual referent', () => openResolver({})],
  ['Open live (simulated replay)', () => go('live')],
  ...ds().DEMO ? [['Play the opening demonstration', () => playIntro()]] : [],
  [`Turn privacy masking ${S.settings.privacy.faces || S.settings.privacy.plates ? 'off' : 'on'}`, togglePrivacy],
  ['Export investigation', () => exportPackage()],
  ...cams.filter(c => c.status !== 'offline').map(c => [`Search ${c.code} · ${c.name}`, () => { S.scope = c.id; go('search', focusQ); }]),
  ...allEvents.map(e => [`Jump to ${cam(e.cameraId).code} ${e.time} · ${name(e)}`, () => openEvidence(e.id)]),
];
const paletteLayer = () => `<div class="pal"><label class="sr-only" for="pal-q">Command</label>
  <input id="pal-q" placeholder="Command, camera or timestamp" autocomplete="off" role="combobox" aria-controls="pal-list" aria-expanded="true">
  <ul id="pal-list" role="listbox" aria-label="Commands"></ul>
  <p class="mono dim">/ search · Ctrl K commands · E evidence · C compare · M memory · Space play · ←→ step · J/L sightings · F focus · Esc close</p></div>`;
function palFilter() {
  const v = $('#pal-q').value.toLowerCase();
  PAL.items = commands().filter(([l]) => l.toLowerCase().includes(v)).slice(0, 9);
  PAL.i = 0; palDraw();
}
function palDraw() {
  $('#pal-list').innerHTML = PAL.items.map(([l], i) => `<li role="option" id="po${i}" aria-selected="${i === PAL.i}" data-act="pal" data-i="${i}">${esc(l)}</li>`).join('');
  $('#pal-q').setAttribute('aria-activedescendant', PAL.items.length ? 'po' + PAL.i : '');
}
const palRun = i => { const c = PAL.items[i]; if (!c) return; dlg.close(); c[1](); };

// ---------- actions ----------
// Page changes cross-fade and slide in the nav's direction. The swap is async under a view transition, so work that
// needs the new page (focus, scroll) goes in `after`.
const ORDER = ['search', 'cameras', 'live', 'memory', 'investigation', 'system'];
function go(view, after) {
  const swap = () => { set({ view }); scrollTo(0, 0); after?.(); };
  if (view === S.view || !document.startViewTransition || reduced.matches || dlg.open) return swap();
  const root = document.documentElement;
  root.style.setProperty('--vt-dir', ORDER.indexOf(view) < ORDER.indexOf(S.view) ? -1 : 1);
  root.classList.add('vt-nav');
  document.startViewTransition(swap).finished.finally(() => root.classList.remove('vt-nav'));
}
function focusQ() { const q = $('#q'); q?.focus(); q?.select(); }
function follow(track) { if (dlg.open) dlg.close(); S.context = { track }; S.jtab = 'sequence'; run('Where did it go?'); }

function openEvidence(id, off = 0, src) {
  const open = () => openLayer({ kind: 'evidence', id, off });
  if (!src || !document.startViewTransition || reduced.matches || dlg.open) return open();
  src.style.viewTransitionName = 'evidence';
  document.startViewTransition(() => { src.style.viewTransitionName = ''; open(); });
}

async function run(text) {
  text = String(text || '').trim();
  if (!text) return focusQ();
  S.abort?.abort();
  const ac = new AbortController();
  set({ view: 'search', phase: 'searching', query: text, stages: [], interp: null, res: null, error: null, abort: ac, zoom: 0 });
  try {
    const res = await api.search(text, { scope: S.scope, context: S.context, depth: S.depth ?? S.settings.depth, signal: ac.signal,
      onStage: s => { S.stages.push(s); if (s.interp) S.interp = s.interp; render(); } });
    S.res = res; S.interp = res.interp;
    S.history = await api.getHistory(); S.memory = await api.getMemory();
    if (res.status === 'clarify') {
      const term = res.interp.location.term;
      set({ phase: 'clarifying', resolver: { term, name: term.replace(/\b\w/g, m => m.toUpperCase()), cameraId: null, rect: null, inline: true } });
    } else {
      const track = res.status === 'journey' ? res.journey.track : res.status === 'supported' ? ev(res.primary).track : null;
      set({ phase: 'result', context: track ? { track } : null });
    }
    $('.verdict')?.focus({ preventScroll: true });
  } catch (err) {
    if (ac !== S.abort) return;
    set(err.name === 'AbortError' ? { phase: 'cancelled' } : { phase: 'error', error: err.message });
  }
}

async function exportPackage(only) {
  const why = exportBlock();
  if (why) return toast(why);
  const items = only ? [{ kind: 'event', eventId: only, query: S.query, lane: 'primary' }] : S.saved.filter(x => !x.expired && here(x)), p = S.settings.privacy;
  const out = ['# Case evidence', '', ds().DEMO ? '> DEMO DATA: synthetic footage and detections. Not real evidence.\n' : '',
    p.exports === 'watermarked' ? `> RESTRICTED · exported by role "${S.settings.operator.role}" on ${new Date().toISOString()} · do not redistribute\n` : '',
    `Generated ${new Date().toISOString()} · faces ${p.faces ? 'masked' : 'unmasked'} · plates ${p.plates ? 'masked' : 'unmasked'}`, ''];
  let lane;
  for (const x of [...items].sort((a, b) => Object.keys(api.LANES).indexOf(a.lane) - Object.keys(api.LANES).indexOf(b.lane))) {
    if (!only && x.lane !== lane) out.push(`# ${api.LANES[lane = x.lane]}`, '');
    if (x.kind === 'journey') {
      const j = api.journey(x.track);
      out.push(`## Journey · track ${tid(x.track)} · ${ds().tracks[x.track]}`, `- Query: "${x.query || '-'}"`,
        ...j.sightings.map((id, i) => `- ${cam(ev(id).cameraId).code} ${ev(id).time} ${ds().TZ}${i ? ` (${STRENGTH[j.transitions[i - 1].strength].toLowerCase()}, +${dur(j.transitions[i - 1].gap)})` : ''}`), '');
      continue;
    }
    const e = ev(x.eventId), c = cam(e.cameraId), j = api.journey(e.track);
    out.push(`## ${c.code} · ${e.time} ${ds().TZ} · ${e.label}`, `- Camera: ${c.code} ${c.name} (clock offset ${fmtSync(c.sync)})`, `- Source clip: ${clipName(e)}`,
      `- Object: ${name(e)} · track ${tid(e.track)}`, `- Query: "${x.query || '-'}"`, `- Assessment: ${api.assess(e).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
      `- Journey: ${j.sightings.map(id => `${cam(ev(id).cameraId).code} ${ev(id).time}`).join(' → ')}`, '');
  }
  if (!only) out.push('## Searches', ...S.history.map(h => `- ${h.at} "${h.text}" → ${STATUS[h.status]}`), '', '## Notes', S.notes || '-');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([out.join('\n')], { type: 'text/markdown' })), download: `evidence-${ds().DAY}.md` });
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  toast(`Evidence package ready · ${items.length} item${items.length === 1 ? '' : 's'}`);
  if (!only && S.saved.some(x => x.expired)) toast(`${S.saved.filter(x => x.expired).length} expired item(s) left out`);
}

function toast(msg) {
  const t = Object.assign(document.createElement('p'), { textContent: msg });
  $('#toasts').append(t); setTimeout(() => t.remove(), 3500);
}

const keepName = () => { if ($('#res-name')) S.resolver.name = $('#res-name').value; };
const redrawResolver = () => S.resolver.inline ? render() : openLayer({ kind: 'resolver' });
let notesTimer;

const THEMES = ['system', 'light', 'dark'];
const theme = () => document.documentElement.dataset.theme || 'system';
function cycleTheme() {
  const next = THEMES[(THEMES.indexOf(theme()) + 1) % 3];
  if (next === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = next;
  try { next === 'system' ? localStorage.removeItem('vi.theme') : localStorage.setItem('vi.theme', next); } catch {}
  render();
}

const ACT = {
  theme: cycleTheme,
  setup: () => openSetup(),
  'setup-install': () => startInstall(),
  'setup-later': async () => { S.settings = await api.setSettings({ vision: { setupSeen: true } }); dlg.close(); },
  intro: () => ds().DEMO && playIntro(),
  'intro-try': () => { dlg.close(); run('Did a red car pass through the main gate?'); },
  'pin-journey': async d => { await api.saveJourney(d.track, S.query); S.saved = await api.getSaved(); toast('Journey pinned to the evidence board'); },
  nudge: d => { const x = S.saved.find(i => i.id === d.id), lane = S.saved.filter(i => i.lane === x.lane); moveCard(d.id, x.lane, lane.indexOf(x) + +d.d); },
  'compare-picked': () => openLayer({ kind: 'compare', ids: [...picked] }),
  register: async () => { S.setup = await api.getSetup(); openLayer({ kind: 'register' }); },
  'src-open': d => openSources(d.tab),
  'src-tab': d => { SRC.tab = d.tab; SRC.q = ''; SRC.sel.clear(); drawSources(); loadSourceList(); },
  'src-add-cams': () => addPickedCams(),
  'meva-go': d => { SRC.mevaPrefix = d.prefix; loadSourceList(); },
  'meva-import': () => importMeva(),
  'feed-toggle': async d => { S.ingest = await api.updateFeed(d.id, { active: d.on === '1' }); render(); pollVideos(); },
  'feed-del': async d => { if (!confirm('Stop capturing this camera? Clips already indexed stay.')) return; S.ingest = await api.removeFeed(d.id); render(); },
  'imports-clear': async () => { S.ingest = await api.clearImports(); render(); },
  'camera-del': async d => {
    const vs = S.videos.filter(v => v.cameraKey === d.key);
    if (!confirm(`Remove “${vs[0].name}” and its ${vs.length} clips? Their frames and index are deleted.`)) return;
    for (const v of vs) await api.deleteVideo(v.id);
    S.videos = await api.getVideos(); await loadDataset(); clearSearch(); render();
  },
  source: d => switchSource(d.src),
  'play-orig': d => openLayer({ kind: 'video', id: d.id, t: +d.t, det: d.det !== '0' }),
  vmode: (d, b) => { V.det = d.m === 'det'; $$('[data-act=vmode]').forEach(x => x.setAttribute('aria-pressed', x === b)); },
  'video-reindex': async d => { await api.reindexVideo(d.id); pollVideos(); },
  'video-del': async d => {
    const v = S.videos.find(x => x.id === d.id);
    if (!confirm(`Remove “${v.name}”? The uploaded copy, its frames and its index are deleted.`)) return;
    await api.deleteVideo(d.id); S.videos = await api.getVideos(); await loadDataset(); clearSearch(); render();
  },
  'live-toggle': () => S.live.running ? S.live.ac.abort() : liveStart(),
  'live-reset': () => { S.live.ac?.abort(); Object.assign(S.live, { t: W[0], feed: [], streams: {}, done: false, lastAt: null }); render(); },
  'watch-toggle': async d => { const w = S.watches.find(x => x.id === d.id); await api.updateWatch(d.id, { status: w.status === 'active' ? 'paused' : 'active' }); S.watches = await api.getWatches(); render(); },
  'watch-del': async d => { if (!confirm('Delete this standing query? Its past alerts stay in the log.')) return; await api.deleteWatch(d.id); S.watches = await api.getWatches(); render(); },
  'define-term': d => openResolver({ name: d.term.replace(/\b\w/g, m => m.toUpperCase()), term: d.term }),
  diag: () => openLayer({ kind: 'diag' }),
  go: d => go(d.view), ask: d => run(d.q), open: (d, el) => openEvidence(d.id, +(d.off || 0), el),
  close: () => dlg.close(), cancel: () => S.abort?.abort(), unfollow: () => set({ context: null }),
  reveal: d => reveal(d.id), palette: () => openLayer({ kind: 'palette' }), zoom: d => zoomTo(+d.z),
  compare: d => openLayer({ kind: 'compare', ids: d.ids.split(',') }), bridge: d => openLayer({ kind: 'compare', ids: [d.from, d.to], bridge: true }),
  passport: d => openLayer({ kind: 'passport', track: d.track }), follow: d => follow(d.track), jtab: d => set({ jtab: d.tab }),
  save: async d => { await api.saveEvidence(d.id, S.query); S.saved = await api.getSaved(); toast('Evidence saved to investigation'); },
  unsave: async d => { await api.removeEvidence(d.id); picked.delete(d.id); S.saved = await api.getSaved(); render(); },
  export: () => exportPackage(), exportone: d => exportPackage(d.id),
  camera: d => { S.camFocus = d.id; go('cameras', () => $('#row-' + d.id)?.scrollIntoView({ block: 'center' })); },
  scope: d => { S.scope = d.id; go('search', focusQ); },
  define: () => openResolver({}),
  redefine: d => { const r = S.memory.find(x => x.id === d.id); openResolver({ id: r.id, name: r.name, cameraId: r.cameraId, rect: [...r.region] }); },
  forget: async d => {
    const r = S.memory.find(x => x.id === d.id);
    if (!confirm(`Forget “${r.name}”? Queries that name it will ask again.`)) return;
    await api.deleteMemory(d.id); S.memory = await api.getMemory(); render(); toast(`Forgot ${r.name}`);
  },
  'res-cam': d => { keepName(); Object.assign(S.resolver, { cameraId: d.id, rect: null }); redrawResolver(); },
  'save-ref': saveRef,
  play: togglePlay, step: d => stepBy(+d.d), seek: d => { stopPlay(); P.off = +d.off; drawFrame(); },
  focusmode: (d, b) => { S.layer.focus = !S.layer.focus; $('.ev').classList.toggle('focus', S.layer.focus); b.setAttribute('aria-pressed', S.layer.focus); },
  pal: d => palRun(+d.i), 'focus-q': () => focusQ(),
  expand: () => run(S.query.replace(/\b(after|before) \d{1,2}(:\d{2})?\s*(am|pm)?/gi, '').replace(/\s+/g, ' ')),
  allcams: () => { S.scope = 'all'; run(S.query); },
};

document.addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  e.preventDefault();
  ACT[b.dataset.act]?.(b.dataset, b);
});
dlg.addEventListener('click', e => {
  const r = dlg.getBoundingClientRect();
  if (e.target === dlg && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)) dlg.close();
});

document.addEventListener('submit', e => {
  if (e.target.dataset.form === 'settings') { e.preventDefault(); return saveSettings(e.target); }
  if (e.target.dataset.form === 'watch') { e.preventDefault(); return saveWatch(e.target); }
  if (e.target.dataset.form === 'register') { e.preventDefault(); return uploadFootage(e.target); }
  if (e.target.dataset.form === 'stream') { e.preventDefault(); return submitStream(e.target); }
  if (e.target.dataset.form === 'urls') { e.preventDefault(); return submitUrls(e.target); }
  if (e.target.dataset.form !== 'search') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  S.scope = fd.get('scope'); S.depth = fd.get('depth'); run(fd.get('q'));
});

document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'q') S.query = t.value;
  else if (t.dataset.srcQ !== undefined) { SRC.q = t.value; const at = t.selectionStart; drawSources(); const n = dlg.querySelector('[data-src-q]'); n?.focus(); n?.setSelectionRange(at, at); }
  else if (t.id === 'notes') { clearTimeout(notesTimer); S.notes = t.value; notesTimer = setTimeout(() => api.setNotes(S.notes), 400); }
  else if (t.id === 'scrub') { stopPlay(); P.off = +t.value; drawFrame(); }
  else if (t.id === 'pal-q') palFilter();
  else if (t.dataset.xywh) setRect($$('[data-xywh]').map((x, i) => clamp(+x.value || 0, 0, i % 2 ? 360 : 640)));
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.id === 'speed') P.speed = +t.value;
  else if (t.id === 'live-speed') S.live.speed = +t.value;
  else if (t.dataset.day !== undefined) switchDay(t.value);
  else if (t.dataset.pickCam) { t.checked ? SRC.sel.set(t.dataset.pickCam, 1) : SRC.sel.delete(t.dataset.pickCam); drawSources(); }
  else if (t.dataset.srcInterval !== undefined) { SRC.interval = +t.value; drawSources(); }
  else if (t.dataset.srcClip !== undefined) { SRC.clipSec = +t.value; drawSources(); }
  else if (t.dataset.srcDistrict !== undefined) { SRC.district = +t.value; SRC.sel.clear(); loadSourceList(); }
  else if (t.dataset.meva) { t.checked ? SRC.mevaSel.add(t.dataset.meva) : SRC.mevaSel.delete(t.dataset.meva); drawSources(); }
  else if (t.dataset.mevaAll !== undefined) { SRC.mevaSel = new Set(t.checked ? SRC.meva.files.map(f => f.key) : []); drawSources(); }
  else if (t.dataset.move) moveCard(t.dataset.move, t.value, 999);
  else if (t.dataset.pick) { t.checked ? picked.add(t.dataset.pick) : picked.delete(t.dataset.pick); render(); $(`[data-pick="${t.dataset.pick}"]`)?.focus(); }
  else if (t.dataset.tog) { P[t.dataset.tog] = t.checked; drawFrame(); }
  else if (t.name === 'scope') S.scope = t.value;
});

// Evidence board drag and drop (keyboard equivalent: each card's lane menu and arrows).
document.addEventListener('dragstart', e => {
  const c = e.target.closest?.('[data-card]');
  if (!c) return;
  e.dataTransfer.setData('text/plain', c.dataset.card); e.dataTransfer.effectAllowed = 'move'; c.classList.add('dragging');
});
document.addEventListener('dragend', e => e.target.closest?.('[data-card]')?.classList.remove('dragging'));
document.addEventListener('dragover', e => { const l = e.target.closest?.('[data-lane]'); if (!l) return; e.preventDefault(); $$('.lane.over').forEach(x => x !== l && x.classList.remove('over')); l.classList.add('over'); });
document.addEventListener('drop', e => {
  const l = e.target.closest?.('[data-lane]');
  if (!l) return;
  e.preventDefault(); l.classList.remove('over');
  const id = e.dataTransfer.getData('text/plain'), before = e.target.closest('[data-card]');
  const order = $$('[data-card]', l).map(x => x.dataset.card).filter(x => x !== id);
  moveCard(id, l.dataset.lane, before && before.dataset.card !== id ? order.indexOf(before.dataset.card) : order.length);
});

// Region drawing on the resolver canvas.
document.addEventListener('pointerdown', e => {
  const cv = e.target.closest('[data-draw]');
  if (!cv) return;
  e.preventDefault();
  const box = cv.getBoundingClientRect();
  const pt = m => [clamp(Math.round((m.clientX - box.left) / box.width * 640), 0, 640), clamp(Math.round((m.clientY - box.top) / box.height * 360), 0, 360)];
  const [x0, y0] = pt(e);
  const move = m => { const [x1, y1] = pt(m); setRect([Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]); };
  const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});

// Timeline marker preview.
const peek = $('#peek');
const showPeek = m => {
  const e = ev(m.dataset.id), r = m.getBoundingClientRect();
  peek.innerHTML = still(e) + `<p class="mono">${e.time} · ${cam(e.cameraId).code}</p><p>${esc(name(e))} · ${e.action}</p>`;
  Object.assign(peek.style, { left: clamp(r.left + r.width / 2 - 110, 8, innerWidth - 228) + 'px', top: r.top - 10 + 'px' });
  peek.hidden = false;
};
document.addEventListener('pointerover', e => { const m = e.target.closest('.mk'); m ? showPeek(m) : (peek.hidden = true); });
document.addEventListener('focusin', e => { const m = e.target.closest?.('.mk'); m ? showPeek(m) : (peek.hidden = true); });
addEventListener('scroll', () => (peek.hidden = true), { passive: true });

document.addEventListener('keydown', e => {
  const k = e.key, t = e.target;
  if ((e.metaKey || e.ctrlKey) && k.toLowerCase() === 'k') { e.preventDefault(); return openLayer({ kind: 'palette' }); }
  if (S.layer?.kind === 'palette') {
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); PAL.i = clamp(PAL.i + (k === 'ArrowDown' ? 1 : -1), 0, PAL.items.length - 1); palDraw(); }
    else if (k === 'Enter') { e.preventDefault(); palRun(PAL.i); }
    return;
  }
  if (t.matches?.('[role=button][data-act]') && (k === 'Enter' || k === ' ')) { e.preventDefault(); t.click(); return; }
  if (t.closest?.('input, textarea, select')) {
    if (t.id === 'q' && k === 'Enter' && !e.shiftKey) { e.preventDefault(); t.form.requestSubmit(); }
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  if (S.layer?.kind === 'evidence') {
    if ((k === ' ' && !t.closest?.('button')) || k === 'k') { e.preventDefault(); togglePlay(); }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') { e.preventDefault(); stepBy(k === 'ArrowLeft' ? -0.5 : 0.5); }
    else if (k === 'j' || k === 'l') { const j = api.journey(ev(P.id).track), n = j.sightings[j.sightings.indexOf(P.id) + (k === 'j' ? -1 : 1)]; n && openLayer({ kind: 'evidence', id: n }); }
    else if (k === 'f') $('[data-act=focusmode]')?.click();
    return;
  }
  if (dlg.open) return;
  if (k === '/') { e.preventDefault(); S.view === 'search' ? focusQ() : go('search', focusQ); }
  else if (k === 'm') go('memory');
  else if (k === 'e' && S.res?.primary) openEvidence(S.res.primary);
  else if (k === 'c' && S.res?.candidates) openLayer({ kind: 'compare', ids: S.res.candidates });
});

// Contextual cursor label (desktop, fine pointer, motion allowed only). Native cursor stays visible.
const CURSOR = [['[data-draw]', 'DRAW'], ['#scrub, .tl-ticks', 'SCRUB'], ['.crop, .sight-frame, .cand-frame', 'INSPECT'], ['[data-act=camera], [data-act=res-cam]', 'OPEN'],
  ['[data-act=compare], [data-act=bridge], [data-act=compare-picked]', 'COMPARE'], ['[data-card]', 'MOVE'], ['.lead, .thumb, .hood button, .mk, .consist button, .pp button, .card-frame, .jstrip button', 'VIEW']];
if (matchMedia('(hover: hover) and (pointer: fine)').matches && !reduced.matches) {
  const cur = $('#cursor');
  addEventListener('pointermove', e => {
    const hit = CURSOR.find(([sel]) => e.target.closest?.(sel));
    const host = dlg.open ? dlg : document.body;
    if (cur.parentNode !== host) host.append(cur);
    cur.hidden = !hit;
    if (hit) { cur.textContent = hit[1]; cur.style.transform = `translate(${e.clientX + 16}px, ${e.clientY + 16}px)`; }
  }, { passive: true });
}

// ---------- render ----------
const VIEWS = { live: liveView, search: searchView, cameras: camerasView, memory: memoryView, investigation: investigationView, system: systemView };
function render() {
  const y = scrollY;
  $('#app').innerHTML = header() + `<main id="main" tabindex="-1">${VIEWS[S.view]()}</main>`;
  scrollTo(0, y);
}

try {
  await loadDataset();
  [S.memory, S.history, S.saved, S.notes, S.settings, S.audit, S.watches, S.alerts] = await Promise.all([
    api.getMemory(), api.getHistory(), api.getSaved(), api.getNotes(), api.getSettings(), api.getAudit(), api.getWatches(), api.getAlerts()]);
  if (mode === 'server') { [S.videos, S.ingest] = await Promise.all([api.getVideos(), api.getIngest()]); if (S.ingest.feeds.some(f => f.active)) pollVideos(); if (S.videos.some(v => v.status !== 'ready' && v.status !== 'failed')) pollVideos(); }
} catch (e) {
  $('#app').innerHTML = `<main class="boot-fail"><p class="eyebrow">Could not start</p><h1 class="claim">The local server did not answer as expected.</h1>
    <p class="dim">${esc(e.message)}</p><p>Close this window and open <b>Video Intelligence.exe</b> again; it restarts an outdated server.</p></main>`;
  throw e;
}
render();
// First launch: offer to set up local analysis (server mode only; the browser-only mock cannot run models).
if (mode === 'server' && !S.settings.vision.setupSeen) api.getSetup().then(s => { if (!setupReady(s)) { S.setup = s; openLayer({ kind: 'setup' }); if (s.job && !s.job.finished) pollSetup(); } }).catch(() => {});


// Installable app (PWA); the worker only serves offline.html when the local server is down.
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Keep an icon-started server alive while the app is open (it exits when idle; see server.mjs VI_IDLE_EXIT).
if (mode === 'server') setInterval(() => fetch('api/health', { cache: 'no-store' }).catch(() => {}), 60e3);
