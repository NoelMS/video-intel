// DEMO DATA. Synthetic, internally consistent, NOT real footage or real model output.
// Shapes mirror GET /cameras, /cameras/:id/events, /memory. Replace via api.js.
export const DEMO = true;
export const TZ = 'IST';
export const DAY = '2026-10-08';
export const WINDOW = ['09:00:00', '10:00:00'];

export const cameras = [
  { id: 'cam_02', code: 'CAM 02', name: 'Service Road',  scene: 'road',  status: 'ready',   coverage: [['09:00:00', '10:00:00']], sync: 0.42,  neighbors: ['cam_06'] },
  { id: 'cam_03', code: 'CAM 03', name: 'West Fence',    scene: 'fence', status: 'offline', coverage: [['09:00:00', '09:20:00']], sync: null,  neighbors: [] },
  { id: 'cam_04', code: 'CAM 04', name: 'Main Gate',     scene: 'gate',  status: 'ready',   coverage: [['09:00:00', '10:00:00']], sync: 0,     neighbors: ['cam_06', 'cam_07'] },
  { id: 'cam_06', code: 'CAM 06', name: 'Parking',       scene: 'lot',   status: 'ready',   coverage: [['09:00:00', '10:00:00']], sync: 1.24,  neighbors: ['cam_04', 'cam_07', 'cam_08', 'cam_02'] },
  { id: 'cam_07', code: 'CAM 07', name: 'Lobby Drive',   scene: 'lobby', status: 'partial', coverage: [['09:00:00', '09:38:00'], ['09:52:00', '10:00:00']], sync: -0.38, neighbors: ['cam_04', 'cam_06', 'cam_09'] },
  { id: 'cam_08', code: 'CAM 08', name: 'Loading Area',  scene: 'dock',  status: 'ready',   coverage: [['09:00:00', '10:00:00']], sync: 0.10,  neighbors: ['cam_06'] },
  { id: 'cam_09', code: 'CAM 09', name: 'Rear Entrance', scene: 'rear',  status: 'ready',   coverage: [['09:00:00', '10:00:00']], sync: -0.05, neighbors: ['cam_07'] },
];

// bbox/path in 640x360 frame space. path = object centre trajectory across a 16 s clip.
// conf = model scores from the (demo) retrieval + appearance stages.
const car = (color, kind) => ({ kind: 'vehicle', shape: kind, color });
const person = (color, carry = null) => ({ kind: 'person', color, carry });

export const events = [
  { id: 'ev_091412', cameraId: 'cam_04', time: '09:14:12', track: 'A17', entity: 'vehicle', look: car('#a8322b', 'sedan'),
    attrs: ['red', 'sedan'], action: 'entering', label: 'Red sedan enters through the north gate', path: [[90, 262], [500, 236]],
 conf: { semantic: 0.94, visual: 0.91 }, quality: { occlusion: 'none', blur: 'low', lighting: 'good', angle: 'good' } },
  { id: 'ev_091548', cameraId: 'cam_06', time: '09:15:48', track: 'A17', entity: 'vehicle', look: car('#a8322b', 'sedan'),
    attrs: ['red', 'sedan'], action: 'parking', label: 'Red sedan turns into row C', path: [[580, 210], [320, 268]],
    conf: { semantic: 0.90, visual: 0.86 }, quality: { occlusion: 'low', blur: 'low', lighting: 'good', angle: 'medium' } },
  { id: 'ev_091604', cameraId: 'cam_06', time: '09:16:04', track: 'B03', entity: 'vehicle', look: car('#b4473a', 'hatchback'),
    attrs: ['red', 'hatchback'], action: 'leaving', label: 'Red hatchback leaves row A', path: [[220, 250], [600, 226]],
    conf: { semantic: 0.81, visual: 0.62 }, quality: { occlusion: 'medium', blur: 'low', lighting: 'good', angle: 'medium' } },
  { id: 'ev_091703', cameraId: 'cam_07', time: '09:17:03', track: 'A17', entity: 'vehicle', look: car('#a8322b', 'sedan'),
    attrs: ['red', 'sedan'], action: 'passing', label: 'Red sedan passes the lobby drop-off', path: [[40, 270], [560, 262]],
    conf: { semantic: 0.88, visual: 0.79 }, quality: { occlusion: 'low', blur: 'medium', lighting: 'good', angle: 'good' } },
  { id: 'ev_091744', cameraId: 'cam_04', time: '09:17:44', track: 'D02', entity: 'vehicle', look: car('#6e2a2e', 'suv'),
    attrs: ['maroon', 'red', 'suv'], action: 'stopping', label: 'Maroon SUV stops short of the gate and reverses', path: [[80, 266], [250, 258]],
 conf: { semantic: 0.70, visual: 0.60 }, quality: { occlusion: 'low', blur: 'low', lighting: 'good', angle: 'good' } },
  { id: 'ev_092241', cameraId: 'cam_09', time: '09:22:41', track: 'A17', entity: 'vehicle', look: car('#a8322b', 'sedan'),
    attrs: ['red', 'sedan'], action: 'stopping', label: 'Red sedan stops near the rear entrance', path: [[620, 258], [360, 262]],
 conf: { semantic: 0.86, visual: 0.74 }, quality: { occlusion: 'medium', blur: 'low', lighting: 'low', angle: 'medium' } },
  { id: 'ev_092630', cameraId: 'cam_08', time: '09:26:30', track: 'C21', entity: 'vehicle', look: car('#d9d6cc', 'van'),
    attrs: ['white', 'van'], action: 'stopping', label: 'White van stops at loading bay 2', path: [[600, 250], [330, 244]],
 conf: { semantic: 0.92, visual: 0.88 }, quality: { occlusion: 'none', blur: 'low', lighting: 'good', angle: 'good' } },
  { id: 'ev_092910', cameraId: 'cam_08', time: '09:29:10', track: 'P08', entity: 'person', look: person('#6b6f72', 'box'),
    attrs: ['grey', 'jacket', 'box'], action: 'entering', label: 'Person carries a box into the building', path: [[260, 270], [330, 214]],
 conf: { semantic: 0.89, visual: 0.83 }, quality: { occlusion: 'low', blur: 'low', lighting: 'good', angle: 'medium' } },
  { id: 'ev_093320', cameraId: 'cam_02', time: '09:33:20', track: 'P11', entity: 'person', look: person('#2f5d8c'),
    attrs: ['blue', 'jacket'], action: 'entering', label: 'Person in a blue jacket walks through the service gate', path: [[170, 272], [470, 252]],
    conf: { semantic: 0.91, visual: 0.87 }, quality: { occlusion: 'none', blur: 'low', lighting: 'good', angle: 'good' } },
  { id: 'ev_093610', cameraId: 'cam_06', time: '09:36:10', track: 'P11', entity: 'person', look: person('#2f5d8c'),
    attrs: ['blue', 'jacket'], action: 'walking', label: 'Person in a blue jacket crosses the parking lot', path: [[110, 262], [560, 250]],
    conf: { semantic: 0.87, visual: 0.80 }, quality: { occlusion: 'medium', blur: 'low', lighting: 'good', angle: 'medium' } },
  { id: 'ev_094105', cameraId: 'cam_09', time: '09:41:05', track: 'P11', entity: 'person', look: person('#2f5d8c'),
    attrs: ['blue', 'jacket'], action: 'entering', label: 'Person in a blue jacket enters the rear entrance', path: [[560, 270], [440, 220]],
 conf: { semantic: 0.84, visual: 0.71 }, quality: { occlusion: 'low', blur: 'medium', lighting: 'low', angle: 'medium' } },
  { id: 'ev_094800', cameraId: 'cam_06', time: '09:48:00', track: 'P20', entity: 'person', look: person('#26282a', 'bag'),
    attrs: ['black', 'jacket', 'bag', 'large'], action: 'walking', label: 'Person carrying a large black bag crosses parking', path: [[600, 256], [140, 270]],
    conf: { semantic: 0.74, visual: 0.58 }, quality: { occlusion: 'low', blur: 'high', lighting: 'medium', angle: 'medium' } },
  { id: 'ev_095012', cameraId: 'cam_09', time: '09:50:12', track: 'P21', entity: 'person', look: person('#33302c', 'bag'),
    attrs: ['black', 'dark', 'coat', 'bag', 'large'], action: 'waiting', label: 'Person with a large dark bag waits near the rear entrance', path: [[330, 268], [380, 262]],
    conf: { semantic: 0.71, visual: 0.55 }, quality: { occlusion: 'medium', blur: 'low', lighting: 'low', angle: 'high' } },
];

export const seedReferents = [
  { id: 'ref_main_gate', name: 'Main Gate',     cameraId: 'cam_04', region: [290, 150, 140, 170], definedBy: 'Operator', created: '2026-10-02', uses: 23, lastUsed: '2026-10-07' },
  { id: 'ref_loading',   name: 'Loading Area',  cameraId: 'cam_08', region: [190, 130, 300, 190], definedBy: 'Operator', created: '2026-10-02', uses: 9,  lastUsed: '2026-10-06' },
  { id: 'ref_rear',      name: 'Rear Entrance', cameraId: 'cam_09', region: [360, 120, 200, 190], definedBy: 'Operator', created: '2026-10-03', uses: 14, lastUsed: '2026-10-07' },
  { id: 'ref_lobby',     name: 'Lobby',         cameraId: 'cam_07', region: [140, 120, 360, 200], definedBy: 'Operator', created: '2026-10-04', uses: 4,  lastUsed: '2026-10-05' },
];

// GET /objects/:id — track descriptions as the tracker/captioner would supply them.
export const tracks = {
  A17: 'Red sedan', B03: 'Red hatchback', D02: 'Maroon SUV', C21: 'White van',
  P08: 'Person carrying a box', P11: 'Person in a blue jacket', P20: 'Person with a large black bag', P21: 'Person with a large dark bag',
};
