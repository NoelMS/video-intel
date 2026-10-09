// Camera stills as SVG: synthetic scenes for the demo, or the real extracted frame for your footage. Either way the
// same overlays (box, trajectory, region, privacy masks, burn-in) sit on top in the app's 640x360 frame space.
import { camera, pointAt, sec, hms, ds } from './api.js';

const INK = '#5d5b55', DIM = '#363531', BG = '#181918', GROUND = '#1f201f', TXT = '#cfc9bc', ACC = '#e0a84f';
const L = (x1, y1, x2, y2, c = DIM, w = 1) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"/>`;
const R = (x, y, w, h, c = INK, f = 'none') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" stroke="${c}" fill="${f}"/>`;
const range = n => [...Array(n).keys()];

const scenes = {
  gate: () => `<polygon points="0,360 640,360 420,200 230,200" fill="#232422"/>
    ${range(9).map(i => L(i * 32, 168, i * 32, 210, INK)).join('')}${L(0, 172, 290, 172, INK)}
    ${R(288, 110, 12, 186, INK, '#2a2a27')}${R(426, 110, 12, 186, INK, '#2a2a27')}${L(300, 122, 300, 40, INK, 3)}
    ${R(480, 140, 80, 100)}${R(495, 160, 50, 30, DIM)}${L(320, 360, 330, 200, '#4a4842')}`,
  lot: () => `${range(9).map(i => L(40 + i * 72, 214, 10 + i * 82, 300, '#44423d')).join('')}
    ${L(0, 214, 640, 214, '#44423d')}${L(120, 60, 120, 214, INK, 2)}${L(500, 50, 500, 214, INK, 2)}
    ${L(100, 60, 140, 60, INK, 2)}${L(480, 50, 520, 50, INK, 2)}`,
  lobby: () => `${R(110, 50, 430, 160)}${range(6).map(i => R(130 + i * 70, 70, 50, 34, DIM)).join('')}
    ${R(285, 128, 80, 82, INK, '#202120')}${L(325, 128, 325, 210, INK)}${L(220, 118, 430, 118, INK, 3)}
    ${L(0, 300, 640, 290, '#3d3c37')}`,
  dock: () => `${R(50, 60, 540, 160)}${[100, 255, 410].map((x, i) => `${R(x, 115, 120, 105, INK, '#1c1d1c')}
    ${range(6).map(j => L(x, 130 + j * 15, x + 120, 130 + j * 15)).join('')}
    <text x="${x}" y="108" fill="${INK}" font-size="10" font-family="IBM Plex Mono, monospace">BAY ${i + 1}</text>`).join('')}`,
  rear: () => `${R(-1, 30, 642, 180)}${R(430, 100, 86, 110, INK, '#1c1d1c')}${L(400, 210, 546, 210, INK)}
    ${L(410, 222, 536, 222, DIM)}${R(462, 78, 22, 8, INK, '#3a3934')}${range(5).map(i => L(0, 60 + i * 30, 380, 60 + i * 30)).join('')}`,
  road: () => `<polygon points="60,360 600,360 380,200 300,200" fill="#232422"/>
    ${range(20).map(i => i * 34).filter(x => x < 250 || x > 380).map(x => L(x, 150, x, 205, INK)).join('')}
    ${L(0, 160, 250, 160, INK)}${L(380, 160, 640, 160, INK)}${R(246, 130, 8, 80, INK, '#2a2a27')}${R(376, 130, 8, 80, INK, '#2a2a27')}`,
  fence: () => range(16).map(i => L(i * 42, 120, i * 42, 230, INK)).join('') + range(8).map(i => L(0, 125 + i * 14, 640, 125 + i * 14)).join(''),
};

function vehicle(l, cx, cy, s, privacy) {
  const [w, h] = { sedan: [124, 42], hatchback: [106, 44], suv: [128, 54], van: [144, 68] }[l.shape].map(v => v * s);
  const x = cx - w / 2, y = cy - h, cab = l.shape === 'van' ? [0.04, 0.3] : [0.22, 0.36];
  return {
    box: [x, y, w, h],
    svg: `<rect x="${x}" y="${y + h * 0.36}" width="${w}" height="${h * 0.54}" rx="${3 * s}" fill="${l.color}"/>
      <polygon points="${x + w * cab[0]},${y + h * 0.38} ${x + w * cab[1]},${y} ${x + w * 0.74},${y} ${x + w * 0.86},${y + h * 0.38}" fill="${l.color}"/>
      <polygon points="${x + w * (cab[0] + 0.05)},${y + h * 0.36} ${x + w * (cab[1] + 0.02)},${y + h * 0.08} ${x + w * 0.72},${y + h * 0.08} ${x + w * 0.8},${y + h * 0.36}" fill="#0f1112" opacity=".75"/>
      <circle cx="${x + w * 0.2}" cy="${y + h * 0.9}" r="${h * 0.16}" fill="#0b0b0b"/><circle cx="${x + w * 0.8}" cy="${y + h * 0.9}" r="${h * 0.16}" fill="#0b0b0b"/>
      <rect x="${cx - 10 * s}" y="${y + h * 0.66}" width="${20 * s}" height="${7 * s}" fill="#e8e3d6" ${privacy ? 'filter="url(#pv)"' : ''}/>`,
  };
}

function person(l, cx, cy, s, privacy) {
  const w = 18 * s, h = 64 * s, x = cx - w / 2, y = cy - h;
  const carry = l.carry === 'bag' ? `<rect x="${x + w}" y="${y + h * 0.42}" width="${16 * s}" height="${18 * s}" fill="#0d0d0d"/>`
    : l.carry === 'box' ? `<rect x="${x - 6 * s}" y="${y + h * 0.3}" width="${30 * s}" height="${18 * s}" fill="#8a6d47"/>` : '';
  return {
    box: [x - 8 * s, y - 2, w + 30 * s, h + 4],
    svg: `<circle cx="${cx}" cy="${y + 7 * s}" r="${7 * s}" fill="#b39478" ${privacy ? 'filter="url(#pv)"' : ''}/>
      <rect x="${x}" y="${y + 15 * s}" width="${w}" height="${28 * s}" rx="${2 * s}" fill="${l.color}"/>
      ${L(cx - 4 * s, y + 43 * s, cx - 5 * s, cy, '#1b1b1b', 5 * s)}${L(cx + 4 * s, y + 43 * s, cx + 5 * s, cy, '#1b1b1b', 5 * s)}${carry}`,
  };
}

// opts: ev, offset (s from event), box, trail, region {rect,name}, privacy {faces, plates}, crop, time
// Real frames: the extracted frame nearest in time to the event (+ offset), the track's box on that exact frame,
// and opaque redaction over the faces/plates the model reported (it can miss some; the System page says so).
function realFrame(c, ev, offset, privacy) {
  const at = ev ? ev.t + offset : c.frames[Math.floor(c.frames.length / 2)]?.t ?? 0;
  const f = c.frames.reduce((a, b) => !a || Math.abs(b.t - at) < Math.abs(a.t - at) ? b : a, null);
  if (!f) return { scene: '', obj: null, stamp: '', masked: '' };
  const d = ev?.dets.find(x => Math.abs(x.t - f.t) < 0.05);
  const masks = [...(privacy.faces ? f.faces : []), ...(privacy.plates ? f.plates : [])];
  return {
    scene: `<image href="api/videos/${f.v ?? c.id}/frames/${f.n}" width="640" height="360" preserveAspectRatio="none"/>`
      + masks.map(([x, y, w, h]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="#151514"/>`).join(''),
    obj: d ? { box: d.box, svg: '' } : null, stamp: hms(c.t0 + f.t), masked: masks.length ? `${masks.length} REGION${masks.length > 1 ? 'S' : ''} MASKED` : '',
  };
}

export function frame(cameraId, { ev = null, offset = 0, box = true, trail = false, region = null, privacy = { faces: true, plates: true }, crop = false, time = null } = {}) {
  const c = camera(cameraId);
  let obj = null, masked = '', stamp, scene;
  if (c.real) ({ scene, obj, stamp, masked } = realFrame(c, ev, offset, privacy));
  else {
    const t = (offset + 8) / 16;
    if (ev && t >= 0 && t <= 1) {
      const [cx, cy] = pointAt(ev, t), s = 0.75 + (cy - 200) / 240;
      obj = ev.look.kind === 'vehicle' ? vehicle(ev.look, cx, cy, s, privacy.plates) : person(ev.look, cx, cy, s, privacy.faces);
    }
    masked = obj && (ev.look.kind === 'vehicle' ? privacy.plates && 'PLATE MASKED' : privacy.faces && 'FACE MASKED');
    stamp = ev ? hms(sec(ev.time) + Math.round(offset)) : time ?? '';
    scene = `<rect y="200" width="640" height="160" fill="${GROUND}"/>${L(0, 200, 640, 200)}${scenes[c.scene]()}`;
  }
  // Boxes and regions live in a 640x360 space for every camera. A camera that is not 16:9 (e.g. 4:3 CCTV) is shown at
  // its true shape by scaling that space vertically by ky; labels sit outside the scaled group so text never stretches.
  const ky = c.real && c.width ? 640 * c.height / c.width / 360 : 1, H = 360 * ky;
  let vb = `0 0 640 ${H}`;
  if (crop && obj) {
    const [x, y, w, h] = obj.box, cw = Math.max(w, h * ky * 1.6) * 1.5, ch = cw / 1.6;
    vb = `${x + w / 2 - cw / 2} ${(y + h / 2) * ky - ch / 2} ${cw} ${ch}`;
  }
  const label = `${c.code} ${c.name}${stamp ? ' at ' + stamp : ''}${ev && obj ? ', ' + ev.label : ''}.${masked ? ' ' + masked.toLowerCase() + '.' : ''}${c.real ? '' : ' Synthetic demo frame.'}`;
  const mono = (x, y, size, extra = '') => `x="${x}" y="${y}" font-size="${size}" font-family="IBM Plex Mono, monospace" ${extra}`;
  return `<svg class="frame" viewBox="${vb}" preserveAspectRatio="xMidYMid slice" ${crop ? '' : `style="aspect-ratio: 640 / ${H}"`} role="img" aria-label="${label}">
    <defs><filter id="pv"><feGaussianBlur stdDeviation="3.2"/></filter></defs>
    <rect x="-400" y="-400" width="1440" height="1600" fill="${BG}"/>
    <g transform="scale(1 ${ky})">${scene}
    ${region ? `<${region.shape?.length ? `polygon points="${region.shape.map(p => p.join(',')).join(' ')}"` : `rect x="${region.rect[0]}" y="${region.rect[1]}" width="${region.rect[2]}" height="${region.rect[3]}"`} fill="${ACC}" fill-opacity=".07" stroke="${ACC}" stroke-dasharray="4 3" vector-effect="non-scaling-stroke"/>` : ''}
    ${trail && ev ? `<polyline points="${[0, 0.25, 0.5, 0.75, 1].map(k => pointAt(ev, k).join(',')).join(' ')}" fill="none" stroke="${ACC}" stroke-opacity=".55" stroke-dasharray="2 4" vector-effect="non-scaling-stroke"/>` : ''}
    ${obj ? obj.svg : ''}
    ${obj && box ? (([x, y, w, h]) => `<g stroke="${ACC}" fill="none" vector-effect="non-scaling-stroke"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke-opacity=".7" stroke-width=".8" vector-effect="non-scaling-stroke"/>
      <path d="M${x} ${y + 8 / ky}V${y}H${x + 8}M${x + w - 8} ${y}H${x + w}V${y + 8 / ky}M${x + w} ${y + h - 8 / ky}V${y + h}H${x + w - 8}M${x + 8} ${y + h}H${x}V${y + h - 8 / ky}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></g>`)(obj.box) : ''}
    </g>
    ${region ? `<text ${mono(region.rect[0] + 4, region.rect[1] * ky - 5, 10, `fill="${ACC}" letter-spacing=".08em"`)}>${region.name.toUpperCase()}</text>` : ''}
    ${obj && box ? `<text ${mono(obj.box[0], obj.box[1] * ky - 6, 10, `fill="${ACC}" paint-order="stroke" stroke="#000" stroke-opacity=".45" stroke-width="2"`)}>${String(ev.track).includes(':') ? '#' + String(ev.track).split(':').pop() : ev.track} · ${ev.entity.toUpperCase()}</text>` : ''}
    ${crop ? '' : `<text ${mono(14, 24, 11, `fill="${TXT}" letter-spacing=".06em" opacity=".85" paint-order="stroke" stroke="#000" stroke-opacity=".5" stroke-width="2"`)}>${c.code}  ${c.name.toUpperCase()}</text>
    <text ${mono(626, 24, 11, `fill="${TXT}" text-anchor="end" opacity=".85" paint-order="stroke" stroke="#000" stroke-opacity=".5" stroke-width="2"`)}>${ds().DAY} ${stamp} ${ds().TZ}</text>
    ${c.real ? '' : `<text ${mono(14, H - 14, 9, `fill="${TXT}" opacity=".45"`)}>SYNTHETIC DEMO FRAME</text>`}
    ${masked ? `<text ${mono(626, H - 14, 9, `fill="${TXT}" text-anchor="end" opacity=".7"`)}>${masked}</text>` : ''}`}
  </svg>`;
}
