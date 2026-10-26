// Balls for the palette, like KeyShot's material library: a real sphere with
// the viewer's own material for that finish, lit by a studio. Also Zebra
// (the real stripe shader, so the stripes follow the curve) and Mesh (a
// triangle mesh wrapped round the ball). One small offscreen renderer, one
// ball at a time, cached by look + colours + settings (the finish balls wear
// the colour coat you've picked; the Pattern ball the pattern).

import * as THREE from 'three';
import { applyLook, createMaterials, FINISH_LOOKS, type FinishOpts, type Look, type LookColors } from './materials';
import { patternDepthMm } from './patterns';
import { studioById, studioScene } from './studio';

const PX = 96;
/** Ball radius in mm (the brushed grain and coating pattern are in mm). */
const R = 18;
let kit: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  ball: THREE.Mesh;
  meshBall: THREE.Mesh;
  mats: ReturnType<typeof createMaterials>;
} | null = null;
let envReady: Promise<void> | null = null;

/** The sphere. */
function ballGeometry() {
  const geo = new THREE.SphereGeometry(R, 128, 64);
  const n = geo.getAttribute('position').count;
  // The analysis shader expects these.
  geo.setAttribute('crease', new THREE.BufferAttribute(new Float32Array(n), 1));
  geo.setAttribute('contact', new THREE.BufferAttribute(new Float32Array(n), 1));
  // Brushed needs tangents for its streaked highlight.
  geo.computeTangents();
  return geo;
}

/** A triangle mesh round a ball, a little uneven like a real solver mesh. */
function meshGeometry() {
  // Big triangles: on a 32 px button finer ones read as dots (Guy).
  const geo = new THREE.IcosahedronGeometry(R, 1);
  const pos = geo.getAttribute('position');
  // Shared corners get the same nudge (the geometry repeats them per triangle).
  const nudge = (x: number, y: number, z: number) => {
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return (h - Math.floor(h) - 0.5) * 3.5;
  };
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = v.clone().normalize();
    // Slide each corner a little along the surface, then back onto the ball.
    v.x += nudge(k.x, k.y, k.z);
    v.y += nudge(k.y, k.z, k.x);
    v.z += nudge(k.z, k.x, k.y);
    v.setLength(R);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  // Corner weights, for drawing each triangle's edges as thick lines.
  const bary = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) bary[i * 3 + (i % 3)] = 1;
  geo.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
  geo.computeVertexNormals();
  return geo;
}

/** Dark shaded ball with each triangle's edges as thick mint lines (a
 *  one-pixel wireframe vanished once the ball was shrunk onto the button). */
function meshMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: `
      attribute vec3 bary;
      varying vec3 vBary;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vBary = bary;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalMatrix * normal;
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vBary;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float e = min(min(vBary.x, vBary.y), vBary.z);
        float w = fwidth(e);
        float line = 1.0 - smoothstep(1.0 * w, 1.9 * w, e);
        float lit = 0.35 + 0.65 * clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        vec3 col = mix(vec3(0.16, 0.18, 0.2) * lit, vec3(0.65, 1.0, 0.94) * (0.55 + 0.45 * lit), line);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

function setup() {
  if (kit) return kit;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(PX, PX, false);
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const mats = createMaterials();
  const ball = new THREE.Mesh(ballGeometry(), mats.metal);
  // Grain and film run round the ball as they would across a sheet.
  ball.rotation.x = Math.PI / 2;
  scene.add(ball);
  const mg = meshGeometry();
  const meshBall = new THREE.Mesh(mg, meshMaterial());
  scene.add(meshBall);
  const camera = new THREE.PerspectiveCamera(26, 1, 0.1 * R, 100 * R);
  camera.up.set(0, 0, 1);
  kit = { renderer, scene, camera, ball, meshBall, mats };
  return kit;
}

/** The Loft (a real bright room): windows and floor in the reflections, so
 *  polished reads as shiny metal, not a grey blob (the plain studio did). */
function environment() {
  envReady ??= (async () => {
    const k = setup();
    const def = studioById('loft');
    const room = await studioScene(def, 0, 0, 0.5);
    const pmrem = new THREE.PMREMGenerator(k.renderer);
    k.scene.environment = pmrem.fromScene(room, 0, 0.1, 100, { size: 256 }).texture;
    k.renderer.toneMappingExposure = def.exposure;
    pmrem.dispose();
  })();
  return envReady;
}

const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

/** Pattern repeat on a ball: never so fine it blurs away at button size. */
const ballPatternSize = (o: FinishOpts) => Math.max(o.patternSize, 5);

/** Only what changes a ball goes in its cache key. */
function finishKey(look: Look, colors: LookColors, opts: FinishOpts) {
  const parts: (string | number | boolean | null)[] = [look];
  if (FINISH_LOOKS.includes(look)) {
    parts.push(opts.coat);
    if (opts.coat === 'pvd') parts.push(colors.pvd, opts.pvdAmount);
    if (opts.coat === 'iridescent') parts.push(colors.beetleFace, colors.beetleEdge);
    if (opts.coat === 'heat') parts.push(opts.heatRange);
    if (opts.coat === 'powder') parts.push(opts.powderColor, opts.powderGloss, opts.powderTexture, opts.powderMetallic);
    if (opts.coat === 'candy') parts.push(opts.candyColor, opts.candyDepth);
    if (look === 'brushed') parts.push(opts.brushAngle);
    if (opts.pattern) parts.push(opts.pattern, ballPatternSize(opts), opts.patternDepth, opts.patternAngle, opts.patternTops, opts.patternInvert, opts.patternNegative, opts.patternLevel);
  }
  return parts.join('|');
}

function render(key: string, draw: (k: NonNullable<typeof kit>) => void): Promise<string> {
  let p = cache.get(key);
  if (!p) {
    const job = queue.then(async () => {
      await environment();
      const k = setup();
      draw(k);
      k.renderer.render(k.scene, k.camera);
      return k.renderer.domElement.toDataURL('image/png');
    });
    queue = job.catch(() => undefined);
    p = job;
    cache.set(key, p);
  }
  return p;
}

/** The ball as a finish, Zebra or Mesh. */
function dress(k: NonNullable<typeof kit>, look: Look, colors: LookColors, opts: FinishOpts) {
  const mesh = look === 'mesh';
  // From a little above; Zebra from nearly level, so its stripes run round
  // the ball as curved bands (from above they closed into a bullseye).
  k.camera.position.set(0.55, -1.35, look === 'zebra' ? 0.12 : 0.75).setLength(4.75 * R);
  k.camera.lookAt(0, 0, 0);
  k.camera.updateMatrixWorld();
  k.ball.visible = !mesh;
  k.meshBall.visible = mesh;
  // spanMm sets how big the grain / colour pattern is on the ball.
  const { material } = applyLook(k.mats, look, colors, false, { ...opts, brushGrain: 1, heatSize: 140, heatX: 0.2, heatY: 0.1, pvdSize: 160 }, 120);
  k.mats.overlay.uniforms.stripes.value = 7;
  // The pattern in mm round the ball (UVs run round it and pole to pole).
  const size = ballPatternSize(opts);
  k.mats.tig.patSpan.value.set(2 * Math.PI * R, Math.PI * R);
  k.mats.tig.patSize.value = size;
  k.mats.tig.patDepth.value = patternDepthMm(size, opts.patternDepth);
  if (!mesh) k.ball.material = material;
}

/** A data-URL picture of a ball in this look (finishes, Zebra, Mesh), with
 *  the coat and pattern in `opts`. */
export function finishPreview(look: Look, colors: LookColors, opts: FinishOpts): Promise<string> {
  return render(finishKey(look, colors, opts), (k) => dress(k, look, colors, opts));
}
