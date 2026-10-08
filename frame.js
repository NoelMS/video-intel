// Synthetic camera stills (SVG). Stand-in for decoded video frames: when an event carries
// a real `still`/`clip` URL, the app renders that instead (see app.js `media()`).
import { camera, pointAt, sec, hms } from './api.js';
import { DAY, TZ } from './data.js';

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
export function frame(cameraId, { ev = null, offset = 0, box = true, trail = false, region = null, privacy = { faces: true, plates: true }, crop = false, time = null } = {}) {
  const c = camera(cameraId);
  const t = (offset + 8) / 16;
  let obj = null;
  if (ev && t >= 0 && t <= 1) {
    const [cx, cy] = pointAt(ev, t), s = 0.75 + (cy - 200) / 240;
    obj = ev.look.kind === 'vehicle' ? vehicle(ev.look, cx, cy, s, privacy.plates) : person(ev.look, cx, cy, s, privacy.faces);
  }
  const masked = obj && (ev.look.kind === 'vehicle' ? privacy.plates && 'PLATE MASKED' : privacy.faces && 'FACE MASKED');
  const stamp = ev ? hms(sec(ev.time) + Math.round(offset)) : time ?? '';
  let vb = '0 0 640 360';
  if (crop && obj) {
    const [x, y, w, h] = obj.box, cw = Math.max(w, h * 1.6) * 1.5, ch = cw / 1.6;
    vb = `${x + w / 2 - cw / 2} ${y + h / 2 - ch / 2} ${cw} ${ch}`;
  }
  const label = `${c.code} ${c.name}${stamp ? ' at ' + stamp : ''}${ev && obj ? ', ' + ev.label : ''}.${masked ? ' ' + masked.toLowerCase() + '.' : ''} Synthetic demo frame.`;
  return `<svg class="frame" viewBox="${vb}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="${label}">
    <defs><filter id="pv"><feGaussianBlur stdDeviation="3.2"/></filter></defs>
    <rect x="-400" y="-400" width="1440" height="1160" fill="${BG}"/><rect y="200" width="640" height="160" fill="${GROUND}"/>${L(0, 200, 640, 200)}
    ${scenes[c.scene]()}
    ${region ? `<rect x="${region.rect[0]}" y="${region.rect[1]}" width="${region.rect[2]}" height="${region.rect[3]}" fill="${ACC}" fill-opacity=".07" stroke="${ACC}" stroke-dasharray="4 3"/>
      <text x="${region.rect[0] + 4}" y="${region.rect[1] - 5}" fill="${ACC}" font-size="10" font-family="IBM Plex Mono, monospace" letter-spacing=".08em">${region.name.toUpperCase()}</text>` : ''}
    ${trail && ev ? `<polyline points="${[0, 0.25, 0.5, 0.75, 1].map(k => pointAt(ev, k).join(',')).join(' ')}" fill="none" stroke="${ACC}" stroke-opacity=".55" stroke-dasharray="2 4"/>` : ''}
    ${obj ? obj.svg : ''}
    ${obj && box ? (([x, y, w, h]) => `<g stroke="${ACC}" fill="none"><rect x="${x}" y="${y}" width="${w}" height="${h}" stroke-opacity=".7" stroke-width=".8"/>
      <path d="M${x} ${y + 8}V${y}H${x + 8}M${x + w - 8} ${y}H${x + w}V${y + 8}M${x + w} ${y + h - 8}V${y + h}H${x + w - 8}M${x + 8} ${y + h}H${x}V${y + h - 8}" stroke-width="1.6"/></g>
      <text x="${x}" y="${y - 6}" fill="${ACC}" font-size="10" font-family="IBM Plex Mono, monospace">${ev.track} · ${ev.entity.toUpperCase()}</text>`)(obj.box) : ''}
    ${crop ? '' : `<text x="14" y="24" fill="${TXT}" font-size="11" font-family="IBM Plex Mono, monospace" letter-spacing=".06em" opacity=".85">${c.code}  ${c.name.toUpperCase()}</text>
    <text x="626" y="24" fill="${TXT}" font-size="11" font-family="IBM Plex Mono, monospace" text-anchor="end" opacity=".85">${DAY} ${stamp} ${TZ}</text>
    <text x="14" y="346" fill="${TXT}" font-size="9" font-family="IBM Plex Mono, monospace" opacity=".45">SYNTHETIC DEMO FRAME</text>
    ${masked ? `<text x="626" y="346" fill="${TXT}" font-size="9" font-family="IBM Plex Mono, monospace" text-anchor="end" opacity=".7">${masked}</text>` : ''}`}
  </svg>`;
}
