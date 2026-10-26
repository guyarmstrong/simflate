// Render studios: what the metal reflects when you render from Snapshots.
//
// Polished steel is a mirror, so a studio is mostly *what it sees*: big soft
// panels and thin strips of light against real darkness, plus dark "cards" so
// a bright studio still gives the metal its edges. Each studio is a little
// scene of glowing panels (or a photographed room, CC0 from Poly Haven) that
// is baked into the environment map. Light angle turns the whole studio round
// the piece; light height raises or lowers the lights.
//
// World is Z-up. Azimuth 0° = behind the default camera (light from the
// front), +90° = to the viewer's right, 180° = behind the piece.

import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** A built-in studio, or `hdri:<id>` for one you imported. */
export type StudioId = string;
export type HdriKind = 'hdr' | 'exr' | 'image';

interface Panel {
  az: number;
  el: number;
  /** Angular width and height, degrees. */
  w: number;
  h: number;
  color: number;
  power: number;
  /** soft: bright centre fading out (softbox) · strip: sharp ends, soft sides · hard: crisp edge · card: dark flag. */
  kind: 'soft' | 'strip' | 'hard' | 'card';
  /** Twist the panel about its own axis, degrees. */
  roll?: number;
  /** Ignores the height slider (floors, horizons). */
  fixed?: boolean;
}

export interface StudioDef {
  id: StudioId;
  name: string;
  hint: string;
  /** Room colour above, at and below the horizon (linear, 0–1). */
  dome: [number, number, number];
  panels: Panel[];
  /** A photographed room instead of the dome. */
  hdri?: string;
  hdriKind?: HdriKind;
  hdriPower?: number;
  exposure: number;
  /** Backdrop when Background is "Studio": centre and edge of a soft radial gradient. */
  backdrop: [string, string];
  /** Heading it sits under in the studio list (lit studios when unset). */
  group?: StudioGroup;
}

export type StudioGroup = 'Studios' | 'Rooms' | 'Outdoors' | 'Yours';

/** A photographed place (CC0 HDRI from Poly Haven, 2k, in `ui/public/studio/`). */
function place(group: StudioGroup, id: string, name: string, hint: string, file: string, power = 1): StudioDef {
  const light = group === 'Rooms';
  return {
    id,
    name,
    hint,
    group,
    dome: [0, 0, 0],
    panels: [],
    hdri: `studio/${file}.hdr`,
    hdriPower: power,
    exposure: 1,
    backdrop: light ? ['#f2f1ee', '#cfcdc8'] : ['#111113', '#050506'],
  };
}

export const STUDIOS: StudioDef[] = [
  {
    id: 'studio',
    name: 'Studio',
    hint: 'The everyday viewer light',
    dome: [0, 0, 0],
    panels: [],
    exposure: 1,
    backdrop: ['#07080a', '#07080a'],
  },
  {
    // Full Blown hero shot: one huge warm softbox the top of the piece
    // mirrors, black all round, strips catching the crinkled seam.
    id: 'noir',
    name: 'Noir',
    hint: 'One big warm light on black',
    dome: [0.006, 0.004, 0.002],
    panels: [
      { az: 180, el: 48, w: 110, h: 60, color: 0xfff0d8, power: 3.2, kind: 'soft' },
      { az: 205, el: 28, w: 3, h: 45, color: 0xffffff, power: 7, kind: 'hard', roll: 8 },
      { az: -110, el: 22, w: 7, h: 70, color: 0xffffff, power: 4, kind: 'strip' },
      { az: 115, el: 30, w: 5, h: 60, color: 0xffffff, power: 3, kind: 'strip', roll: -10 },
      { az: 20, el: 12, w: 70, h: 22, color: 0xfff4e6, power: 0.45, kind: 'soft' },
    ],
    exposure: 1,
    backdrop: ['#16161a', '#060607'],
  },
  {
    // Slate backdrop: cool softboxes all round put bright patches on every
    // lobe, black gaps between them give the deep reflections.
    id: 'slate',
    name: 'Slate',
    hint: 'Cool softboxes, graded grey',
    dome: [0.04, 0.025, 0.006],
    panels: [
      { az: 160, el: 58, w: 80, h: 45, color: 0xf4f7ff, power: 3.6, kind: 'soft' },
      { az: 110, el: 55, w: 35, h: 25, color: 0xffffff, power: 3, kind: 'soft' },
      { az: -150, el: 35, w: 40, h: 35, color: 0xf4f7ff, power: 2.6, kind: 'soft' },
      { az: 95, el: 25, w: 10, h: 65, color: 0xffffff, power: 4, kind: 'strip' },
      { az: -95, el: 25, w: 24, h: 50, color: 0xeef2fa, power: 1.2, kind: 'soft' },
      { az: 0, el: 22, w: 100, h: 34, color: 0xeef2fa, power: 1.8, kind: 'soft' },
      { az: 0, el: 82, w: 80, h: 60, color: 0xf4f7ff, power: 2.2, kind: 'soft' },
    ],
    exposure: 1,
    backdrop: ['#5d6672', '#22262c'],
  },
  {
    // White sweep: a light grey room with big soft panels, black cards and a
    // dark floor so polished steel doesn't melt into the white.
    id: 'white',
    name: 'White',
    hint: 'Light room, black cards for edges',
    dome: [0.75, 0.55, 0.06],
    panels: [
      { az: 180, el: 50, w: 120, h: 55, color: 0xffffff, power: 2.2, kind: 'soft' },
      { az: 0, el: 55, w: 70, h: 35, color: 0xffffff, power: 1.4, kind: 'soft' },
      { az: 140, el: 25, w: 10, h: 70, color: 0x000000, power: 0, kind: 'card' },
      { az: -140, el: 25, w: 10, h: 70, color: 0x000000, power: 0, kind: 'card' },
      { az: 75, el: 10, w: 20, h: 70, color: 0x000000, power: 0, kind: 'card' },
      { az: -75, el: 10, w: 16, h: 70, color: 0x000000, power: 0, kind: 'card' },
      { az: 0, el: -20, w: 360, h: 25, color: 0x000000, power: 0, kind: 'card', fixed: true },
    ],
    exposure: 1,
    backdrop: ['#ffffff', '#e9e9e7'],
  },
  {
    // A white gallery, matched to Guy's photo of the hexagon flower on a wall
    // (session 17): bright ceiling and walls, a mid-grey floor (the darker
    // lower halves of the folds), the photographer as a dark shape in front
    // and soft ceiling lights. Made for Wall / Standing: a flat piece only
    // sees the ceiling.
    id: 'gallery',
    name: 'Gallery',
    hint: 'White gallery wall, as in the photos',
    dome: [0.8, 0.62, 0.18],
    panels: [
      { az: 0, el: 55, w: 100, h: 40, color: 0xffffff, power: 2.4, kind: 'soft' },
      { az: 180, el: 60, w: 90, h: 35, color: 0xffffff, power: 1.4, kind: 'soft' },
      { az: 30, el: 22, w: 16, h: 40, color: 0xffffff, power: 3, kind: 'strip' },
      { az: -35, el: 20, w: 12, h: 36, color: 0xffffff, power: 2.4, kind: 'strip' },
      { az: 0, el: 4, w: 9, h: 24, color: 0x0c0c0c, power: 0, kind: 'card' },
      { az: 62, el: 6, w: 14, h: 26, color: 0x262626, power: 0, kind: 'card' },
      { az: -70, el: 6, w: 10, h: 26, color: 0x1e1e1e, power: 0, kind: 'card' },
      { az: 120, el: 10, w: 18, h: 30, color: 0x2a2a2a, power: 0, kind: 'card' },
      { az: 0, el: -22, w: 360, h: 30, color: 0x3a3a3a, power: 0, kind: 'card', fixed: true },
    ],
    exposure: 1,
    backdrop: ['#f4f4f2', '#d8d8d5'],
  },
  {
    // Hard strip lights on black (car / jewellery look): clean defined lines
    // run along every curve and crease.
    id: 'strips',
    name: 'Strips',
    hint: 'Thin hard strip lights on black',
    dome: [0.003, 0.002, 0.001],
    panels: [
      { az: 180, el: 38, w: 3, h: 85, color: 0xffffff, power: 7, kind: 'hard' },
      { az: 150, el: 50, w: 2.5, h: 70, color: 0xffffff, power: 6, kind: 'hard', roll: 12 },
      { az: -155, el: 45, w: 3, h: 70, color: 0xffffff, power: 6, kind: 'hard', roll: -15 },
      { az: 100, el: 25, w: 4, h: 80, color: 0xffffff, power: 5, kind: 'hard' },
      { az: -100, el: 25, w: 4, h: 80, color: 0xffffff, power: 5, kind: 'hard' },
      { az: 0, el: 62, w: 70, h: 3, color: 0xffffff, power: 5, kind: 'hard' },
      { az: 15, el: 18, w: 80, h: 2.5, color: 0xffffff, power: 3, kind: 'hard' },
    ],
    exposure: 1,
    backdrop: ['#111114', '#040405'],
  },
  {
    // One hard-edged panel plus a strip: graphic, high-contrast edges.
    id: 'edge',
    name: 'Edge',
    hint: 'One hard panel and a strip on black',
    dome: [0.004, 0.003, 0.001],
    panels: [
      { az: 175, el: 45, w: 60, h: 34, color: 0xfffaf2, power: 3, kind: 'hard' },
      { az: -110, el: 22, w: 3, h: 75, color: 0xffffff, power: 7, kind: 'hard' },
      { az: 40, el: 20, w: 30, h: 14, color: 0xffffff, power: 0.8, kind: 'hard' },
    ],
    exposure: 1,
    backdrop: ['#141417', '#050506'],
  },
  // Real rooms: windows, floors and furniture in the reflections.
  place('Rooms', 'loft', 'Loft', 'A real bright room, like in a space', 'photo_studio_loft_hall'),
  place('Rooms', 'bright-room', 'Bright room', 'Empty white room, wood floor, big window', 'lebombo', 0.7),
  place('Rooms', 'country-hall', 'Country hall', 'Rustic studio hall, painted ceiling, windows all round', 'studio_country_hall'),
  place('Rooms', 'london-hall', 'London hall', 'Pale Victorian photo studio, soft daylight', 'photo_studio_london_hall'),
  place('Rooms', 'sitting-room', 'Sitting room', 'Lived-in room with sofa, rug and a garden door', 'reading_room', 0.8),
  place('Rooms', 'cosy-room', 'Cosy room', 'Warm country-house bedroom and fireplace', 'lythwood_room'),
  place('Rooms', 'atelier', 'Atelier', "An artist's workshop full of canvases", 'artist_workshop'),
  place('Rooms', 'hotel-room', 'Hotel room', 'Modern hotel room, warm lamps', 'hotel_room'),
  place('Rooms', 'veranda', 'Veranda', 'Covered brick porch looking onto a lawn', 'veranda'),
  // Outdoors: green and sky in the reflections.
  place('Outdoors', 'garden', 'Garden', 'Trees and sky in the reflections', 'forest_slope', 0.8),
  place('Outdoors', 'courtyard', 'Courtyard garden', 'Sunny garden with trees and a brick house', 'studio_garden', 0.8),
  place('Outdoors', 'formal-garden', 'Formal garden', 'Hedged beds, pergola, big clouds', 'symmetrical_garden_02', 0.8),
  place('Outdoors', 'pond-garden', 'Pond garden', 'Chinese garden with a pond and pavilion', 'chinese_garden', 0.8),
  place('Outdoors', 'park', 'Park, overcast', 'Autumn park under a white sky: soft and even', 'tiergarten', 0.3),
];

/** Your own HDRIs (Render → Import HDRI), once loaded. */
let imported: StudioDef[] = [];
export function setImportedStudios(list: { id: string; name: string; url: string; kind: HdriKind }[]) {
  imported = list.map((h) => ({
    id: `hdri:${h.id}`,
    name: h.name.replace(/\.(hdr|exr|jpe?g|png)$/i, '').replace(/_/g, ' '),
    hint: h.name,
    dome: [0, 0, 0],
    panels: [],
    hdri: h.url,
    hdriKind: h.kind,
    exposure: 1,
    backdrop: ['#121214', '#050506'],
    group: 'Yours' as const,
  }));
}

/** Built-in studios, then yours. */
export const allStudios = () => [...STUDIOS, ...imported];
export const studioById = (id: StudioId) => allStudios().find((s) => s.id === id) || STUDIOS[1];

// --- panel textures -----------------------------------------------------

const texCache = new Map<string, THREE.Texture>();
/** `soft` 0 = crisp edges … 0.5 = as designed … 1 = very diffused. */
function panelTexture(kind: Panel['kind'], soft: number): THREE.Texture {
  const q = Math.round(soft * 20) / 20;
  const key = `${kind}:${q}`;
  const hit = texCache.get(key);
  if (hit) return hit;
  const f = q * 2;
  const n = 256;
  const c = document.createElement('canvas');
  c.width = c.height = n;
  const g = c.getContext('2d')!;
  const img = g.createImageData(n, n);
  const smooth = (e0: number, e1: number, x: number) => {
    const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
    return t * t * (3 - 2 * t);
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = Math.abs((i + 0.5) / n - 0.5) * 2;
      const v = Math.abs((j + 0.5) / n - 0.5) * 2;
      let a = 1;
      if (kind === 'soft') {
        // Hot centre, gentle fall-off, soft edge — a real diffused softbox.
        const r = Math.max(u, v * 0.9);
        const hot = Math.min(0.85, 0.65 * f);
        a = (1 - hot + hot * (1 - smooth(0, 1, Math.hypot(u, v) / 1.3))) * (1 - smooth(Math.min(0.985, 0.97 - 0.15 * f), 1, r));
      } else if (kind === 'strip') {
        a = (1 - smooth(Math.min(0.985, Math.max(0.1, 1 - 0.45 * f)), 1, u)) * (1 - smooth(Math.min(0.985, 1 - 0.07 * f), 1, v));
      } else {
        const e = Math.min(0.985, 1 - 0.04 * f);
        a = (1 - smooth(e, 1, u)) * (1 - smooth(e, 1, v));
      }
      const k = (j * n + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(a * 255);
      img.data[k + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  texCache.set(key, t);
  return t;
}

const hdriCache = new Map<string, Promise<THREE.Texture>>();
function loadHdri(url: string, kind: HdriKind = 'hdr') {
  let p = hdriCache.get(url);
  if (!p) {
    p =
      kind === 'exr'
        ? new EXRLoader().loadAsync(url)
        : kind === 'image'
          ? new THREE.TextureLoader().loadAsync(url).then((t) => ((t.colorSpace = THREE.SRGBColorSpace), t))
          : new HDRLoader().loadAsync(url);
    hdriCache.set(url, p);
  }
  return p;
}

/** Forget a loaded HDRI (when yours is replaced or removed). */
export function dropHdri(url: string) {
  void hdriCache.get(url)?.then((t) => t.dispose());
  hdriCache.delete(url);
}

const deg = Math.PI / 180;
const R = 40;

/** The studio as a scene ready for PMREM, turned by `angle` (°) with lights raised by `height` (−1…1). */
export async function studioScene(def: StudioDef, angle: number, height: number, soft = 0.5): Promise<THREE.Scene> {
  const scene = new THREE.Scene();
  if (def.id === 'studio') {
    // The everyday RoomEnvironment, turned as a whole.
    const room = new RoomEnvironment();
    const g = new THREE.Group();
    g.add(...room.children.slice());
    // Left as the everyday viewer has it, so angle 0 / height 0 matches.
    const turn = new THREE.Group();
    turn.add(g);
    turn.rotation.z = angle * deg;
    turn.rotation.y = height * 0.6;
    scene.add(turn);
    return scene;
  }
  const turn = new THREE.Group();
  turn.rotation.z = angle * deg;
  scene.add(turn);

  if (def.hdri) {
    const tex = await loadHdri(def.hdri, def.hdriKind);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.2, 64, 32),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, color: new THREE.Color().setScalar(def.hdriPower ?? 1) }),
    );
    // Equirect images are Y-up and seen from inside mirror left-right.
    sphere.scale.x = -1;
    sphere.rotation.x = Math.PI / 2;
    const tilt = new THREE.Group();
    tilt.rotation.x = height * 0.45;
    tilt.add(sphere);
    turn.add(tilt);
  } else {
    // Dome graded top → horizon → floor.
    const geo = new THREE.SphereGeometry(R * 1.2, 48, 24);
    const pos = geo.getAttribute('position');
    const cols = new Float32Array(pos.count * 3);
    const [top, mid, bot] = def.dome;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getY(i) / (R * 1.2);
      const v = z >= 0 ? mid + (top - mid) * Math.sqrt(z) : mid + (bot - mid) * Math.min(1, -z * 3);
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = v;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
    dome.rotation.x = Math.PI / 2;
    turn.add(dome);
  }

  for (const p of def.panels) {
    const el = p.fixed ? p.el : Math.min(85, Math.max(-5, p.el + height * 35));
    const dir = new THREE.Vector3(Math.sin(p.az * deg) * Math.cos(el * deg), -Math.cos(p.az * deg) * Math.cos(el * deg), Math.sin(el * deg));
    let mesh: THREE.Object3D;
    if (p.fixed && p.w >= 360) {
      // A band all the way round (a floor or horizon).
      const geo = new THREE.CylinderGeometry(R * 0.95, R * 0.95, 2 * R * 0.95 * Math.tan((p.h / 2) * deg), 48, 1, true);
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: p.color, side: THREE.DoubleSide }));
      m.rotation.x = Math.PI / 2;
      m.position.z = R * 0.95 * Math.tan(p.el * deg);
      mesh = m;
    } else {
      const w = 2 * R * Math.tan((Math.min(p.w, 150) / 2) * deg);
      const h = 2 * R * Math.tan((Math.min(p.h, 150) / 2) * deg);
      const card = p.kind === 'card';
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(p.color).multiplyScalar(card ? 1 : p.power),
        alphaMap: panelTexture(p.kind, soft),
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: card ? THREE.NormalBlending : THREE.AdditiveBlending,
      });
      if (!card) mat.map = panelTexture(p.kind, soft);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      m.position.copy(dir.multiplyScalar(R));
      m.up.set(0, 0, 1);
      m.lookAt(0, 0, 0);
      if (p.roll) m.rotateZ(p.roll * deg);
      // Cards sit in front of the dome, lights in front of cards.
      m.renderOrder = card ? 1 : 2;
      mesh = m;
    }
    turn.add(mesh);
  }
  return scene;
}

/** Where the studio's main light is, as a unit direction from the piece
 *  (z up): its biggest, brightest panel, turned and raised by the Light
 *  angle / height sliders as `studioScene` places it. Rooms without panels
 *  (photographed HDRIs, the everyday studio): high behind-left. */
export function keyLightDirection(def: StudioDef, angle: number, height: number): THREE.Vector3 {
  return keyLight(def, angle, height).dir;
}

/** The main light's direction and its angular radius (degrees) — how big it
 *  looks from the piece, which sets how soft its shadow is. */
export function keyLight(def: StudioDef, angle: number, height: number): { dir: THREE.Vector3; radius: number } {
  const lights = def.panels.filter((p) => p.kind !== 'card');
  const key = lights.length ? lights.reduce((a, b) => (b.power * b.w * b.h > a.power * a.w * a.h ? b : a)) : null;
  const az = key ? key.az : 160;
  const el = key ? (key.fixed ? key.el : Math.min(85, Math.max(-5, key.el + height * 35))) : Math.min(85, Math.max(10, 55 + height * 35));
  const dir = new THREE.Vector3(Math.sin(az * deg) * Math.cos(el * deg), -Math.cos(az * deg) * Math.cos(el * deg), Math.sin(el * deg));
  const radius = key ? Math.sqrt(Math.min(key.w, 150) * Math.min(key.h, 150)) / 2 : 25;
  return { dir: dir.applyAxisAngle(new THREE.Vector3(0, 0, 1), angle * deg).normalize(), radius };
}

/** A soft radial gradient for the Studio backdrop. */
export function gradientTexture(inner: string, outer: string): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(256, 230, 20, 256, 256, 380);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
