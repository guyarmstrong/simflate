// The 3D viewport: shows one frame (live inflation or a saved snapshot), the
// plates and the drawn outline, in the chosen look.

import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { useApp } from '../state/store';
import type { RenderMeshData, SimMesh } from '../sim/simStore';
import { applyLook, createMaterials } from './materials';
import { tigDistances } from './tigBand';
import { gradientTexture, keyLight, studioById, studioScene } from './studio';
import { ASPECTS, renderHook, useRender } from './renderStore';
import type { Vec2 } from '../model/geometry';

interface Props {
  /** Weld outlines (mm) to draw at the weld plane. */
  outlines: Vec2[][];
  /** Plates to draw (z of bottom and top plate, mm), or null. */
  plates: { bottom: number; top: number } | null;
  mesh: SimMesh | null;
  /** Changes when a new piece is shown (re-frames the camera). */
  meshVersion: number;
  frame?: Float32Array;
  crease?: Float32Array;
  contact?: Float32Array;
  current: number;
  render: RenderMeshData | null;
  /** Snapshots view: can show the render studio (Render panel open). */
  stage?: boolean;
}

interface Scene {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  mesh: THREE.Mesh;
  geometry: THREE.BufferGeometry;
  smoothMesh: THREE.Mesh;
  wire: THREE.Mesh;
  smoothWire: THREE.Mesh;
  weld: THREE.Group;
  plates: THREE.Group;
  /** The piece and everything on it (welds, plates, wireframes): spun,
   *  tilted and set on the floor by the geometry position. */
  piece: THREE.Group;
  grid: THREE.GridHelper;
  /** Resting on the floor: dark where it touches, soft under its footprint. */
  shadow: THREE.Mesh;
  /** The piece's real shadow from the studio's main light, on the floor
   *  (Guy: the blob ignored the light and the shape). */
  sun: THREE.DirectionalLight;
  catcher: THREE.Mesh;
  /** Direction to the studio's main light (unit, from the piece). */
  keyDir: THREE.Vector3;
  /** The shadow light's angular radius (degrees, from Shadow softness) and
   *  the catcher's uniform for it. */
  keyRadius: number;
  softUniform: { value: number };
  /** Show ground: a soft floor disc under the piece, in the background's own
   *  colour (a touch lighter when dark) so the shadow has somewhere to fall. */
  floor: THREE.Mesh;
  /** No floor disc (a see-through render background): shadows only. */
  floorHidden: boolean;
  /** The piece's size (mm) and where its middle is now (world). */
  size: number;
  centre: THREE.Vector3;
  /** The piece has been placed once (the camera follows it from then on). */
  placed: boolean;
  /** Render studio on (drawing aids hidden). */
  staging: boolean;
  /** Render mode was on at the last swap (null before the first). */
  wasStaging: boolean | null;
  /** The piece now shown (its outline's extent), for the cameras below. */
  pieceKey: string;
  /** Each mode keeps its own camera (Guy: render's position and camera
   *  don't touch the rest of the program, and are still there when you come
   *  back): saved on leaving, put back on returning to the same piece. */
  cams: Partial<Record<'view' | 'render', { p: THREE.Vector3; t: THREE.Vector3; key: string }>>;
  materials: ReturnType<typeof createMaterials>;
  pmrem: THREE.PMREMGenerator;
  /** The everyday environment and background (outside render mode). */
  baseEnv: THREE.Texture;
  bg: THREE.Color;
  key: THREE.DirectionalLight;
  stageEnv: THREE.WebGLRenderTarget | null;
  stageBg: THREE.Texture | null;
  /** Rebuilds the current studio's lighting at this size (Render uses full size). */
  buildEnv: ((size: number) => Promise<void>) | null;
  /** Gradient backdrop colours, when the backdrop is the studio's own. */
  stageGrad: [string, string] | null;
  /** True while Render has the canvas. */
  paused: boolean;
  /** Something on screen changed: draw on the next animation frame. */
  dirty: boolean;
  /** Idle: a full-quality frame is on screen and held (nothing redrawn) until you touch something. */
  hold: boolean;
  /** Lighting resolution currently built. */
  envSize: number;
  /** What the camera was last framed on (kept with the scene: a rebuilt
   *  scene must frame itself again). */
  framedFor: string;
}

/** Lighting resolution per cube face: quick for the preview, full for Render. */
const PREVIEW_ENV = 256;
const RENDER_ENV = 1024;
const RENDER_SUPERSAMPLE = 3;
/** Untouched this long (ms) in render mode → show a full-quality frame. */
const IDLE_MS = 1200;

export function Viewport3D({ outlines, plates, mesh, meshVersion, frame, crease, contact, current, render, stage = false }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const S = useRef<Scene | null>(null);
  const look = useApp((s) => s.look);
  const pvdColor = useApp((s) => s.pvdColor);
  const beetleFace = useApp((s) => s.beetleFace);
  const beetleEdge = useApp((s) => s.beetleEdge);
  const showPlates = useApp((s) => s.showPlates);
  const smooth = useApp((s) => s.smooth);
  const showWelds = useApp((s) => s.showWelds);
  const finishOpts = useApp((s) => s.finishOpts);
  const filletMm = useApp((s) => s.settings.weldFilletMm);
  const position = useApp((s) => s.position);
  const positionFrame = useApp((s) => s.positionFrame);
  const lookRef = useRef(look);
  lookRef.current = look;
  const studio = useRender();
  const staging = stage && studio.open;
  const positionRef = useRef(position);
  // The geometry position is for Render only: everywhere else the piece lies flat.
  positionRef.current = staging ? position : FLAT_VIEW;
  const [viewSize, setViewSize] = useState<[number, number]>([1, 1]);
  const [frozen, setFrozen] = useState<string | null>(null);
  /** Back to the quick preview (and restart the idle countdown). */
  const wakeRef = useRef<(() => void) | null>(null);
  const badge = useRef<HTMLSpanElement>(null);
  // The flat piece's longer side (mm): UVs run 0–1 across it.
  const spanMm = useMemo(() => {
    const pts = outlines.flat();
    if (!pts.length) return 300;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
  }, [outlines]);
  const outlinesRef = useRef(outlines);
  outlinesRef.current = outlines;

  // Set up three.js once.
  useEffect(() => {
    const el = host.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    // Cast shadows: only the render floor's catcher receives them, and it
    // reads the plain depth map with its own soft area-light filter.
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.BasicShadowMap;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const bg = new THREE.Color(0x07080a);
    scene.background = bg;
    const pmrem = new THREE.PMREMGenerator(renderer);
    const baseEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = baseEnv;

    const camera = new THREE.PerspectiveCamera(35, 1, 1, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(0, -600, 400);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;

    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(-1, -2, 3);
    scene.add(key, new THREE.AmbientLight(0xffffff, 0.15));

    const materials = createMaterials();
    const geometry = new THREE.BufferGeometry();
    const m = new THREE.Mesh(geometry, materials.metal);
    m.frustumCulled = false;
    m.castShadow = true;
    const smoothMesh = new THREE.Mesh(new THREE.BufferGeometry(), materials.metal);
    smoothMesh.frustumCulled = false;
    smoothMesh.castShadow = true;
    smoothMesh.visible = false;
    // Wireframe overlays share the meshes' geometry (Mesh look).
    const wire = new THREE.Mesh(geometry, materials.wire);
    const smoothWire = new THREE.Mesh(smoothMesh.geometry, materials.wire);
    for (const w of [wire, smoothWire]) {
      w.frustumCulled = false;
      w.visible = false;
      w.renderOrder = 1;
    }

    const weld = new THREE.Group();
    const platesGroup = new THREE.Group();
    const piece = new THREE.Group();
    piece.add(m, smoothMesh, wire, smoothWire, weld, platesGroup);
    const grid = new THREE.GridHelper(2000, 40, 0x1c2128, 0x12161b);
    grid.rotation.x = Math.PI / 2;
    // Soft contact shadow for Standing (a blurred dark ellipse on the floor).
    const shadowMesh = (opacity: number) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: shadowTexture(), transparent: true, opacity, depthWrite: false }),
      );
      m.visible = false;
      m.renderOrder = -1;
      return m;
    };
    const shadow = shadowMesh(0.7);
    // Only casts: at no brightness it doesn't light the steel, which keeps
    // lighting by reflection of the studio.
    const sun = new THREE.DirectionalLight(0xffffff, 0);
    sun.castShadow = false;
    sun.shadow.mapSize.set(4096, 4096);
    sun.shadow.bias = -0.0005;
    const softUniform = { value: 0.01 };
    const catcherMat = new THREE.ShadowMaterial({ opacity: 0.62, depthWrite: false });
    catcherMat.onBeforeCompile = (shader) => {
      shader.uniforms.uSoft = softUniform;
      shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', areaShadowChunk());
    };
    catcherMat.customProgramCacheKey = () => 'area-shadow';
    const catcher = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), catcherMat);
    catcher.receiveShadow = true;
    catcher.visible = false;
    catcher.renderOrder = -1;
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1, 96),
      new THREE.MeshBasicMaterial({ color: FLOOR_DARK, alphaMap: floorTexture(), transparent: true, depthWrite: false, toneMapped: false }),
    );
    floor.visible = false;
    floor.renderOrder = -2;
    scene.add(piece, grid, floor, catcher, shadow, sun, sun.target);

    S.current = { renderer, scene, camera, controls, mesh: m, geometry, smoothMesh, wire, smoothWire, weld, plates: platesGroup, piece, grid, shadow, sun, catcher, keyDir: new THREE.Vector3(0.3, 0.6, 0.75).normalize(), keyRadius: 20, softUniform, floor, floorHidden: false, size: 300, centre: new THREE.Vector3(), placed: false, staging: false, wasStaging: null, pieceKey: '', cams: {}, materials, pmrem, baseEnv, bg, key, stageEnv: null, stageBg: null, buildEnv: null, stageGrad: null, paused: false, hold: false, envSize: 0, dirty: true, framedFor: '' };
    // Dev builds only: lets test scripts frame close-ups (camera, controls, dirty).
    if (import.meta.env.DEV) (window as unknown as { __view3d?: unknown }).__view3d = S.current;

    const resize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      setViewSize([w, h]);
      if (S.current) S.current.dirty = true;
      wakeRef.current?.();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();

    // Draw only when the view moves or something shown changed (plus a slow
    // tick for anything loading in the background). Drawing every screen
    // refresh kept the graphics chip ~65 % busy while nothing moved.
    let raf = 0;
    let last = 0;
    const loop = (now: number) => {
      const s = S.current;
      if (s && !s.paused && !s.hold) {
        const moved = controls.update();
        if (moved || s.dirty || now - last > 250) {
          renderer.render(scene, camera);
          s.dirty = false;
          last = now;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      S.current?.stageEnv?.dispose();
      pmrem.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      S.current = null;
    };
  }, []);

  // New mesh topology.
  useEffect(() => {
    const s = S.current;
    if (!s || !mesh) return;
    const g = new THREE.BufferGeometry();
    const n = mesh.vertexCount;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(mesh.uv, 2));
    g.setAttribute('crease', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('contact', new THREE.BufferAttribute(new Float32Array(n), 1).setUsage(THREE.DynamicDrawUsage));
    setTig(g, mesh.uv, outlinesRef.current);
    g.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    s.mesh.geometry.dispose();
    s.mesh.geometry = g;
    s.wire.geometry = g;
    s.geometry = g;
  }, [mesh, meshVersion]);

  // Frame camera on a new mesh (based on the outline) — only when the
  // outline's extent changed: a re-run of the same piece keeps your view
  // (Guy: every changed figure reset the camera).
  useEffect(() => {
    const s = S.current;
    if (!s || (!outlines.length && !frame)) return;
    const box = new THREE.Box3();
    // No outline (some saved forms): the piece's own extent, once per piece.
    let extent: string;
    if (outlines.length) {
      outlines.flat().forEach((p) => box.expandByPoint(new THREE.Vector3(p[0], p[1], 0)));
      extent = [box.min.x, box.min.y, box.max.x, box.max.y].map((v) => v.toFixed(1)).join(',');
    } else {
      for (let i = 0; i < frame!.length; i += 3) box.expandByPoint(new THREE.Vector3(frame![i], frame![i + 1], 0));
      extent = `piece ${meshVersion}`;
    }
    s.pieceKey = extent;
    if (`${extent} ${positionFrame}` === s.framedFor) return;
    s.framedFor = `${extent} ${positionFrame}`;
    const size = box.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.y, 1);
    s.size = r;
    s.placed = false;
    placePiece(s, positionRef.current, box);
    frameCamera(s, positionRef.current.tilt);
    const c = s.centre;
    s.camera.near = r / 200;
    s.camera.far = r * 200;
    s.camera.updateProjectionMatrix();
    const step = niceStep(r / 8);
    s.scene.remove(s.grid);
    s.grid.geometry.dispose();
    const gridShown = s.grid.visible;
    s.grid = new THREE.GridHelper(step * 40, 40, 0x1c2128, 0x111419);
    // Keeps being hidden while the render studio is on.
    s.grid.visible = gridShown;
    s.grid.rotation.x = Math.PI / 2;
    s.grid.position.set(c.x, c.y, 0);
    s.grid.visible = !s.staging;
    s.scene.add(s.grid);
    s.dirty = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshVersion, outlines.length, positionFrame, !!frame]);

  // Tilt / Spin / floor moved: place the piece again and let the camera
  // follow it (same view, not re-framed).
  useEffect(() => {
    const s = S.current;
    if (!s || !s.staging) return;
    placePiece(s, position, null);
    s.dirty = true;
  }, [position.tilt, position.spin, position.floor, position.softness]);

  // Current frame.
  useEffect(() => {
    const s = S.current;
    if (!s || !frame || !mesh) return;
    const g = s.geometry;
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    if (pos.count * 3 !== frame.length) return;
    (pos.array as Float32Array).set(frame);
    pos.needsUpdate = true;
    {
      // Crease field from the solver when we have it; otherwise (snapshots
      // saved before it was stored) how sharply the shape itself folds.
      const field = crease && crease.length === pos.count ? crease : foldSharpness(frame, mesh.indices, mesh.weld);
      const a = g.getAttribute('crease') as THREE.BufferAttribute;
      (a.array as Float32Array).set(field);
      a.needsUpdate = true;
      const [lo, hi] = creaseRange(field);
      s.materials.overlay.uniforms.creaseMin.value = lo;
      s.materials.overlay.uniforms.creaseMax.value = hi;
    }
    if (contact && contact.length === pos.count) {
      const a = g.getAttribute('contact') as THREE.BufferAttribute;
      (a.array as Float32Array).set(contact);
      a.needsUpdate = true;
    }
    g.computeVertexNormals();
    // Brushed needs smooth tangents (grain direction) — else it shows the triangles.
    if (lookRef.current === 'brushed') g.computeTangents();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    s.materials.overlay.uniforms.zRange.value.set(bb.min.z, bb.max.z);
    // On the floor at its lowest point as it is now (or hanging free).
    placePiece(s, positionRef.current, null);
    // meshVersion too: opening the same form again (a double-click) builds a
    // fresh, empty geometry with the same frame — left empty, Render found no
    // lowest point and the piece sank halfway into the floor (session 18).
  }, [frame, crease, contact, mesh, meshVersion]);

  // Smooth render mesh from the finisher.
  useEffect(() => {
    const s = S.current;
    if (!s || !render) return;
    const g = new THREE.BufferGeometry();
    const n = render.positions.length / 3;
    g.setAttribute('position', new THREE.BufferAttribute(render.positions, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(render.uv, 2));
    g.setAttribute('crease', new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute('contact', new THREE.BufferAttribute(new Float32Array(n), 1));
    setTig(g, render.uv, outlinesRef.current);
    g.setIndex(new THREE.BufferAttribute(render.indices, 1));
    g.computeVertexNormals();
    // With a real fillet the seam is round: both sheets share one normal there.
    if (render.fillet) shareSeamNormals(g, render.origin);
    // Smooth per-point tangents for the brushed grain: without them three.js
    // works the direction out per triangle and the brushing speckles.
    g.computeTangents();
    s.smoothMesh.geometry.dispose();
    s.smoothMesh.geometry = g;
    s.smoothWire.geometry = g;
  }, [render]);

  // Look + which mesh to show (the smooth one when it matches the frame on screen).
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    const { material, wire } = applyLook(s.materials, look, { pvd: pvdColor, beetleFace, beetleEdge }, showWelds, finishOpts, spanMm);
    if (look === 'brushed' && !s.geometry.getAttribute('tangent') && s.geometry.getAttribute('normal') && s.geometry.index) s.geometry.computeTangents();
    // The Mesh look sits on pure black so the linework reads clearly.
    s.bg.set(look === 'mesh' ? 0x000000 : 0x07080a);
    s.mesh.material = material;
    s.smoothMesh.material = material;
    const showSmooth = smooth && !!render && render.frame === current && look !== 'crease' && look !== 'contact';
    // The smooth mesh has the fillet as real geometry; the raw mesh (and older
    // snapshots) only shade it.
    s.materials.tig.tigFillet.value = showSmooth && render?.fillet ? 0 : (filletMm ?? 1.5);
    s.smoothMesh.visible = showSmooth;
    s.mesh.visible = !showSmooth && !!mesh;
    s.smoothWire.visible = wire && showSmooth;
    s.wire.visible = wire && !showSmooth && !!mesh;
  }, [look, pvdColor, beetleFace, beetleEdge, showWelds, finishOpts, filletMm, spanMm, smooth, render, current, frame, mesh]);

  // Outlines can arrive after the mesh (snapshots): refresh the weld distances.
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    for (const g of [s.geometry, s.smoothMesh.geometry]) {
      const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
      if (uv) setTig(g, uv.array as Float32Array, outlines);
    }
  }, [outlines]);

  // Weld lines.
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    clearGroup(s.weld);
    // The outline as drawn — a faint dashed reference, so you can see how far
    // the weld has drawn inward.
    const mat = new THREE.LineDashedMaterial({ color: 0xff9a62, transparent: true, opacity: 0.45, dashSize: 4, gapSize: 3 });
    for (const loop of outlines) {
      const pts = loop.map((p) => new THREE.Vector3(p[0], p[1], 0));
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), mat);
      line.computeLineDistances();
      s.weld.add(line);
    }
    // Dashes sized by the piece itself, not its distance from the origin (a
    // piece drawn far out got dashes a quarter of the way round).
    mat.dashSize = spanMm / 120;
    mat.gapSize = spanMm / 180;
  }, [outlines, spanMm]);

  // Plates.
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    clearGroup(s.plates);
    if (!plates || !showPlates || !outlines.length) return;
    const box = new THREE.Box3();
    outlines.flat().forEach((p) => box.expandByPoint(new THREE.Vector3(p[0], p[1], 0)));
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    const w = size.x * 1.35 + 20;
    const h = size.y * 1.35 + 20;
    for (const z of [plates.bottom, plates.top]) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ color: 0xf2c48d, transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }),
      );
      plane.position.set(c.x, c.y, z);
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)),
        new THREE.LineBasicMaterial({ color: 0xf2c48d, transparent: true, opacity: 0.55 }),
      );
      edge.position.copy(plane.position);
      s.plates.add(plane, edge);
    }
  }, [plates, showPlates, outlines]);

  // Render studio: environment (rebuilt when the studio or light moves).
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    if (!staging) {
      s.scene.environment = s.baseEnv;
      s.key.intensity = 1.2;
      return;
    }
    const def = studioById(studio.studio);
    s.keyDir.copy(keyLight(def, studio.angle, studio.height).dir);
    placeSun(s);
    let stale = false;
    const build = (size: number) =>
      studioScene(def, studio.angle, studio.height, studio.softness).then((room) => {
        if (stale || S.current !== s) return;
        // Crisp side: panel edges sharpen. Soft side: the whole studio blurs too
        // (so it also works on strips and photographed rooms).
        const sigma = (def.id === 'studio' ? 0.04 : 0) + Math.max(0, studio.softness - 0.5) * 0.12;
        const rt = s.pmrem.fromScene(room, sigma, 0.1, 100, { size });
        s.stageEnv?.dispose();
        s.stageEnv = rt;
        s.envSize = size;
        s.scene.environment = rt.texture;
      });
    // Preview: a quick 256 map so sliders stay responsive. Render rebuilds it
    // at full size (a mirror shows the map almost 1:1, so 256 blurs edges).
    void build(PREVIEW_ENV);
    s.buildEnv = build;
    // Only the everyday studio has a direct key light; the others light by reflection.
    s.key.intensity = def.id === 'studio' ? 1.2 : 0;
    return () => {
      stale = true;
      if (s.buildEnv === build) s.buildEnv = null;
    };
  }, [staging, studio.studio, studio.angle, studio.height, studio.softness, studio.hdris]);

  // Render studio: background, brightness, and hide the drawing aids.
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    const def = studioById(studio.studio);
    s.renderer.toneMappingExposure = staging ? def.exposure * Math.pow(2, studio.exposure) : 1;
    // Product-shot tone curve in the studios: keeps gold gold instead of greying the highlights.
    s.renderer.toneMapping = staging && def.id !== 'studio' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
    s.staging = staging;
    s.grid.visible = !staging;
    s.weld.visible = !staging;
    s.plates.visible = !staging;
    s.stageBg?.dispose();
    s.stageBg = null;
    s.stageGrad = staging && studio.backdrop === 'studio' ? def.backdrop : null;
    const b = studio.backdrop;
    // The ground takes the background's colour (where it meets the piece).
    s.floorHidden = staging && b === 'transparent';
    const ground = !staging ? '#07080a' : b === 'studio' ? def.backdrop[0] : b === 'black' ? '#000000' : b === 'white' ? '#ffffff' : studio.colour;
    (s.floor.material as THREE.MeshBasicMaterial).color.copy(floorColour(ground));
    s.floor.visible = staging && positionRef.current.floor && !s.floorHidden && s.placed;
    if (!staging) {
      s.scene.background = s.bg;
      return;
    }
    if (b === 'transparent') s.scene.background = null;
    else if (b === 'studio') s.scene.background = s.stageBg = gradientTexture(def.backdrop[0], def.backdrop[1]);
    else s.scene.background = new THREE.Color(b === 'black' ? 0x000000 : b === 'white' ? 0xffffff : studio.colour);
  }, [staging, studio.studio, studio.backdrop, studio.colour, studio.exposure, studio.hdris, outlines]);

  // Into or out of Render: the piece takes Render's position (or lies flat
  // again) and each mode gets its own camera back.
  useEffect(() => {
    const s = S.current;
    if (!s) return;
    if (s.wasStaging === null || s.wasStaging === staging) {
      s.wasStaging = staging;
      return;
    }
    s.wasStaging = staging;
    if (!s.pieceKey) return;
    s.cams[staging ? 'view' : 'render'] = { p: s.camera.position.clone(), t: s.controls.target.clone(), key: s.pieceKey };
    s.placed = false;
    placePiece(s, positionRef.current, null);
    const back = s.cams[staging ? 'render' : 'view'];
    if (back && back.key === s.pieceKey) {
      s.camera.position.copy(back.p);
      s.controls.target.copy(back.t);
    } else frameCamera(s, positionRef.current.tilt);
    s.dirty = true;
  }, [staging]);

  // Idle in render mode: after a moment untouched, show one full-quality frame
  // (full lighting, double sharpness) and hold it. Any click, drag, scroll,
  // key or change of what's shown drops straight back to the quick preview.
  useEffect(() => {
    const s = S.current;
    const el = host.current;
    if (!s || !el || !staging) return;
    let timer = 0;
    let token = 0;
    const basePr = () => Math.min(window.devicePixelRatio, 2);
    const showBadge = (on: boolean) => {
      if (badge.current) badge.current.style.display = on ? '' : 'none';
    };
    const refine = async () => {
      const mine = ++token;
      if (s.paused) {
        timer = window.setTimeout(() => void refine(), IDLE_MS);
        return;
      }
      if (s.envSize !== RENDER_ENV) await s.buildEnv?.(RENDER_ENV);
      if (mine !== token || s.paused || S.current !== s) return;
      const pr = Math.min(basePr() * 2, 4096 / Math.max(el.clientWidth, el.clientHeight, 1));
      s.renderer.setPixelRatio(pr);
      s.renderer.setSize(el.clientWidth, el.clientHeight, false);
      s.renderer.render(s.scene, s.camera);
      s.hold = true;
      showBadge(true);
    };
    const wake = () => {
      token++;
      clearTimeout(timer);
      if (s.hold) {
        s.hold = false;
        s.renderer.setPixelRatio(basePr());
        s.renderer.setSize(el.clientWidth, el.clientHeight, false);
        showBadge(false);
      }
      timer = window.setTimeout(() => void refine(), IDLE_MS);
    };
    const onMove = (e: PointerEvent) => {
      if (e.buttons) wake();
    };
    wakeRef.current = wake;
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('wheel', wake, true);
    window.addEventListener('keydown', wake, true);
    timer = window.setTimeout(() => void refine(), IDLE_MS);
    return () => {
      token++;
      clearTimeout(timer);
      window.removeEventListener('pointerdown', wake, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('wheel', wake, true);
      window.removeEventListener('keydown', wake, true);
      if (s.hold) {
        s.hold = false;
        s.renderer.setPixelRatio(basePr());
        s.renderer.setSize(el.clientWidth, el.clientHeight, false);
      }
      showBadge(false);
      wakeRef.current = null;
    };
  }, [staging]);

  // Anything new to show (timeline playback, look, studio settings) wakes it
  // too, and is drawn on the next animation frame.
  useEffect(() => {
    if (S.current) S.current.dirty = true;
    wakeRef.current?.();
  });

  // Quick export PNG (top right): the view exactly as it is, drawn bigger.
  useEffect(() => {
    quickShot.grab = (longSide) => {
      const s = S.current;
      const el = host.current;
      if (!s || !el) return null;
      const { renderer, scene, camera } = s;
      const w = el.clientWidth;
      const h = el.clientHeight;
      const big = Math.max(w, h, 1);
      const old = renderer.getPixelRatio();
      renderer.setPixelRatio(Math.min(longSide, renderer.capabilities.maxTextureSize) / big);
      renderer.setSize(w, h, false);
      renderer.render(scene, camera);
      // The canvas is see-through where there's no backdrop: lay it on the view's colour.
      const out = document.createElement('canvas');
      out.width = renderer.domElement.width;
      out.height = renderer.domElement.height;
      const g = out.getContext('2d')!;
      g.fillStyle = backgroundOf(el);
      g.fillRect(0, 0, out.width, out.height);
      g.drawImage(renderer.domElement, 0, 0);
      renderer.setPixelRatio(old);
      renderer.setSize(w, h, false);
      renderer.render(scene, camera);
      return out;
    };
    return () => {
      quickShot.grab = null;
    };
  }, []);

  // The Render button: draw the current view at the chosen size.
  useEffect(() => {
    if (!stage) return;
    renderHook.viewAspect = () => {
      const el = host.current;
      return el ? el.clientWidth / Math.max(el.clientHeight, 1) : 1;
    };
    renderHook.render = async (W, H, mime, progress, cancelled) => {
      const s = S.current;
      const el = host.current;
      if (!s || !el) return null;
      const { renderer, camera, scene } = s;
      const frame = () => new Promise((r) => requestAnimationFrame(r));
      // Hold the preview on screen while the canvas is busy rendering tiles.
      // Out of the idle full-quality frame first, then hold the preview on screen
      // while the canvas is busy rendering tiles.
      wakeRef.current?.();
      renderer.render(scene, camera);
      setFrozen(renderer.domElement.toDataURL('image/png'));
      s.paused = true;
      const A = el.clientWidth / Math.max(el.clientHeight, 1);
      const T = W / H;
      // Drawn 3× bigger, in tiles, and shrunk: clean edges and highlights at any size.
      const ss = RENDER_SUPERSAMPLE;
      const tile = Math.min(renderer.capabilities.maxTextureSize, 2048);
      const cols = Math.ceil((W * ss) / tile);
      const rows = Math.ceil((H * ss) / tile);
      const total = cols * rows + 1;
      const old = { pr: renderer.getPixelRatio(), fov: camera.fov, aspect: camera.aspect, bg: scene.background };
      try {
        progress(0, total);
        await frame();
        // Full-quality lighting first.
        if (s.envSize !== RENDER_ENV) await s.buildEnv?.(RENDER_ENV);
        progress(1, total);
        await frame();
        if (cancelled()) return null;
        // Keep the framing: a wider picture shows the same width as the view.
        if (T > A) camera.fov = (2 * Math.atan(Math.tan((old.fov * Math.PI) / 360) * (A / T)) * 180) / Math.PI;
        camera.aspect = T;
        camera.updateProjectionMatrix();
        const out = document.createElement('canvas');
        out.width = W;
        out.height = H;
        const g = out.getContext('2d')!;
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'high';
        // A gradient backdrop would restart in every tile: paint it once here.
        if (s.stageGrad && old.bg instanceof THREE.Texture) {
          paintGradient(g, W, H, s.stageGrad);
          scene.background = null;
        }
        renderer.setPixelRatio(1);
        renderer.setClearColor(0x000000, 0);
        const cw = Math.ceil(W / cols);
        const ch = Math.ceil(H / rows);
        let done = 1;
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const ox = c * cw;
            const oy = r * ch;
            const ow = Math.min(cw, W - ox);
            const oh = Math.min(ch, H - oy);
            if (ow > 0 && oh > 0) {
              renderer.setSize(ow * ss, oh * ss, false);
              camera.setViewOffset(W * ss, H * ss, ox * ss, oy * ss, ow * ss, oh * ss);
              renderer.render(scene, camera);
              g.drawImage(renderer.domElement, 0, 0, ow * ss, oh * ss, ox, oy, ow, oh);
            }
            progress(++done, total);
            await frame();
            if (cancelled()) return null;
          }
        }
        return await new Promise<Blob | null>((res) => out.toBlob(res, mime, 0.93));
      } finally {
        camera.clearViewOffset();
        camera.fov = old.fov;
        camera.aspect = old.aspect;
        camera.updateProjectionMatrix();
        scene.background = old.bg;
        renderer.setPixelRatio(old.pr);
        renderer.setSize(el.clientWidth, el.clientHeight, false);
        s.paused = false;
        setFrozen(null);
      }
    };
    return () => {
      renderHook.render = null;
    };
  }, [stage]);

  const ratio = ASPECTS.find((a) => a.id === studio.aspect)?.ratio ?? null;
  return (
    <div ref={host} className={`viewport3d${staging && studio.backdrop === 'transparent' ? ' see-through' : ''}`} data-testid="viewport3d">
      {staging && ratio && <RenderFrame view={viewSize} ratio={ratio} />}
      <span ref={badge} className="hq-badge" style={{ display: 'none' }} title="Nothing touched for a moment: showing full-quality lighting. Touch anything to go back to the quick preview.">
        Full quality
      </span>
      {frozen && (
        <div className="render-freeze">
          <img src={frozen} alt="" />
          <span>Rendering…</span>
        </div>
      )}
    </div>
  );
}

/** The studio's soft radial backdrop, painted straight onto the picture. */
function paintGradient(g: CanvasRenderingContext2D, W: number, H: number, [inner, outer]: [string, string]) {
  g.save();
  g.scale(W / 512, H / 512);
  const grad = g.createRadialGradient(256, 230, 20, 256, 256, 380);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.restore();
}

/** Shades what falls outside the chosen picture shape. */
function RenderFrame({ view: [w, h], ratio }: { view: [number, number]; ratio: number }) {
  const A = w / Math.max(h, 1);
  const fw = ratio < A ? h * ratio : w;
  const fh = ratio < A ? h : w / ratio;
  return <div className="render-frame" style={{ width: fw, height: fh }} />;
}

/** Crease colour scale for this piece: its strongest folds (98th percentile)
 *  reach the top of the ramp, so a gently creased piece still shows its main
 *  crease instead of reading as all grey. */
/**
 * The Creases colour scale runs over this piece's own range — least creased
 * dark, most creased hot — so even a gently creased piece shows its main
 * folds. Percentiles (2nd–99th) so a single spike doesn't wash it out.
 */
/** Empty a group and free its lines' GPU buffers (they were redrawn on every
 *  outline or plate change and never released). */
function clearGroup(g: THREE.Group) {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    if (m.material) [m.material].flat().forEach((mat) => mat.dispose());
  });
  g.clear();
}

function creaseRange(field: Float32Array): [number, number] {
  const vals = Float32Array.from(field).sort();
  if (vals.length < 8) return [0, 0.6];
  const lo = vals[Math.floor((vals.length - 1) * 0.02)];
  const hi = vals[Math.floor((vals.length - 1) * 0.99)];
  return [lo, Math.max(hi, lo + 1e-4)];
}

/** Per point: the sharpest fold between neighbouring triangles (radians / π),
 *  ignoring the welded rim where the two sheets meet. */
function foldSharpness(pos: Float32Array, idx: Uint32Array, weld: Uint8Array): Float32Array {
  const n = pos.length / 3;
  const out = new Float32Array(n);
  const tris = idx.length / 3;
  const fn = new Float32Array(tris * 3);
  for (let t = 0; t < tris; t++) {
    const a = idx[t * 3] * 3, b = idx[t * 3 + 1] * 3, c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const l = Math.hypot(x, y, z) || 1;
    fn[t * 3] = x / l;
    fn[t * 3 + 1] = y / l;
    fn[t * 3 + 2] = z / l;
  }
  const edge = new Map<number, number>();
  for (let t = 0; t < tris; t++) {
    for (let k = 0; k < 3; k++) {
      const i = idx[t * 3 + k];
      const j = idx[t * 3 + ((k + 1) % 3)];
      if (weld[i] && weld[j]) continue;
      const key = i < j ? i * n + j : j * n + i;
      const other = edge.get(key);
      if (other === undefined) {
        edge.set(key, t);
        continue;
      }
      const d = fn[t * 3] * fn[other * 3] + fn[t * 3 + 1] * fn[other * 3 + 1] + fn[t * 3 + 2] * fn[other * 3 + 2];
      const ang = Math.acos(Math.max(-1, Math.min(1, d))) / Math.PI;
      if (ang > out[i]) out[i] = ang;
      if (ang > out[j]) out[j] = ang;
    }
  }
  return out;
}

/** Average the normals of points that are one point of the watertight mesh
 *  (the seam, split so each sheet has its own), so a rounded seam shades
 *  smoothly across. */
function shareSeamNormals(g: THREE.BufferGeometry, origin: Uint32Array) {
  const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
  const a = nrm.array as Float32Array;
  const first = new Map<number, number>();
  const dup: [number, number][] = [];
  for (let i = 0; i < origin.length; i++) {
    const j = first.get(origin[i]);
    if (j === undefined) first.set(origin[i], i);
    else dup.push([j, i]);
  }
  for (const [i, j] of dup) {
    // Internal welds: the sheets lie back to back (normals opposed) — keep both.
    if (a[i * 3] * a[j * 3] + a[i * 3 + 1] * a[j * 3 + 1] + a[i * 3 + 2] * a[j * 3 + 2] < 0.2) continue;
    let x = a[i * 3] + a[j * 3], y = a[i * 3 + 1] + a[j * 3 + 1], z = a[i * 3 + 2] + a[j * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    x /= l; y /= l; z /= l;
    a[i * 3] = a[j * 3] = x;
    a[i * 3 + 1] = a[j * 3 + 1] = y;
    a[i * 3 + 2] = a[j * 3 + 2] = z;
  }
  nrm.needsUpdate = true;
}

/** Distance to the TIG weld and position along it, per point (weld look). */
function setTig(g: THREE.BufferGeometry, uv: Float32Array, outlines: Vec2[][]) {
  const { dist, along } = tigDistances(uv, outlines);
  g.setAttribute('tig', new THREE.BufferAttribute(dist, 1));
  g.setAttribute('tigS', new THREE.BufferAttribute(along, 1));
}

function niceStep(x: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  return (m < 2 ? 1 : m < 5 ? 2 : 5) * p;
}

/** Set by the mounted 3D view: draw it with its long side `longSide` px. */
export const quickShot: { grab: ((longSide: number) => HTMLCanvasElement | null) | null } = { grab: null };

/** Geometry position: spin the piece in its own plane, tilt it up (0° on
 *  its back … 90° upright facing the camera at −y), then set its lowest
 *  point on the floor (z = 0) — always, so Wall and Standing sit in the same
 *  place; `floor` only shows the ground and the shadows. The camera follows
 *  the piece's middle wherever it moves (re-runs, inflating, tilt), so it
 *  stays where you had it on screen. Works from the shown frame; `outline`
 *  stands in before one. */
function placePiece(s: Scene, pos: { tilt: number; spin: number; floor: boolean; softness: number }, outline: THREE.Box3 | null) {
  // Shadow softness: as from a light 2° (crisp) … 45° (a big softbox) across.
  s.keyRadius = 2 + 43 * Math.min(1, Math.max(0, pos.softness));
  const deg = Math.PI / 180;
  s.piece.rotation.set(pos.tilt * deg, 0, pos.spin * deg);
  s.piece.position.set(0, 0, 0);
  s.piece.updateMatrixWorld();
  const e = s.piece.matrixWorld.elements;
  const arr = s.geometry.getAttribute('position')?.array as Float32Array | undefined;
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity);
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const n = arr && arr.length >= 9 && arr.some((v) => v !== 0) ? arr.length / 3 : 0;
  const world = (x: number, y: number, z: number, out: THREE.Vector3) => out.set(e[0] * x + e[4] * y + e[8] * z, e[1] * x + e[5] * y + e[9] * z, e[2] * x + e[6] * y + e[10] * z);
  const w = new THREE.Vector3();
  if (n) {
    for (let i = 0; i < n; i++) {
      world(arr![3 * i], arr![3 * i + 1], arr![3 * i + 2], w);
      lo.min(w);
      hi.max(w);
    }
  } else if (outline) {
    for (const [x, y] of [[outline.min.x, outline.min.y], [outline.max.x, outline.min.y], [outline.min.x, outline.max.y], [outline.max.x, outline.max.y]]) {
      world(x, y, 0, w);
      lo.min(w);
      hi.max(w);
    }
  } else return;
  const r = s.size;
  const lift = -lo.z;
  s.piece.position.z = lift;
  s.piece.updateMatrixWorld();
  const before = s.centre.clone();
  s.centre.set((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, (lo.z + hi.z) / 2 + lift);
  if (s.placed) {
    const d = s.centre.clone().sub(before);
    s.controls.target.add(d);
    s.camera.position.add(d);
  }
  s.placed = true;
  s.grid.position.set(s.centre.x, s.centre.y, 0);
  s.grid.visible = !s.staging;
  s.shadow.visible = s.staging && pos.floor && n > 0;
  s.catcher.visible = s.sun.castShadow = s.shadow.visible;
  placeSun(s, hi.z - lo.z);
  s.floor.visible = s.shadow.visible && !s.floorHidden;
  s.floor.scale.setScalar(Math.max(hi.x - lo.x, hi.y - lo.y, r) * 1.6);
  // Just under the grid, so its lines still show on it.
  s.floor.position.set(s.centre.x, s.centre.y, -0.5);
  if (!s.shadow.visible) return;
  // Dark where it touches (points within a few mm of the floor), soft under
  // its whole footprint.
  const near = Math.max(2, 0.03 * r);
  const clo = new THREE.Vector2(Infinity, Infinity);
  const chi = new THREE.Vector2(-Infinity, -Infinity);
  for (let i = 0; i < n; i++) {
    world(arr![3 * i], arr![3 * i + 1], arr![3 * i + 2], w);
    if (w.z - lo.z > near) continue;
    clo.set(Math.min(clo.x, w.x), Math.min(clo.y, w.y));
    chi.set(Math.max(chi.x, w.x), Math.max(chi.y, w.y));
  }
  const min = 0.06 * r;
  s.shadow.scale.set(Math.max(chi.x - clo.x, min) * 1.4, Math.max(chi.y - clo.y, min) * 1.4, 1);
  s.shadow.position.set((clo.x + chi.x) / 2, (clo.y + chi.y) / 2, 0.3);
}

/** The shadow light: from the studio's main light towards the piece, its
 *  shadow box just round the piece (sharp), reaching the floor however low
 *  the light is; the catcher under it all. */
function placeSun(s: Scene, tall = s.size) {
  const r = s.size;
  const dir = s.keyDir.clone();
  // Never from below the floor; a grazing light still lands its shadow.
  if (dir.z < 0.12) dir.setZ(0.12).normalize();
  const c = s.centre;
  s.sun.target.position.copy(c);
  s.sun.position.copy(c).addScaledVector(dir, 3 * r);
  const cam = s.sun.shadow.camera;
  // Wide: at the box edge the soft shadow leaves a faint line on the floor.
  const half = 3 * Math.max(r, tall);
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 0.5 * r;
  cam.far = 3 * r + (c.z + r) / dir.z + r;
  cam.updateProjectionMatrix();
  // Penumbra per unit of shadow depth, in shadow-map widths: a light this
  // big blurs a shadow by distance × tan(its radius).
  s.softUniform.value = (Math.tan(s.keyRadius * (Math.PI / 180)) * (cam.far - cam.near)) / (2 * half);
  s.sun.target.updateMatrixWorld();
  s.sun.updateMatrixWorld();
  // Long enough for the longest shadow (a low light throws it far).
  const reach = Math.min(12 * r, (c.z + tall) / dir.z + 2 * r);
  s.catcher.scale.set(2 * reach, 2 * reach, 1);
  s.catcher.position.set(c.x, c.y, 0.2);
}

/** The catcher's shadow lookup: a soft area-light shadow (PCSS) instead of
 *  the hard one — sharp where the piece touches the floor, wider and paler
 *  the further it falls from what casts it, as under a studio softbox
 *  (Guy: it looked like daylight). Finds the average blocker depth, then
 *  filters over the penumbra that depth gives. */
function areaShadowChunk(): string {
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  // The plain (basic) getShadow, found by its depth lookup — the built
  // three.js has no comments to search for. Replaced whole.
  const mark = chunk.indexOf('float depth = texture2D( shadowMap, shadowCoord.xy ).r;');
  const start = chunk.lastIndexOf('float getShadow(', mark);
  const ret = chunk.indexOf('return mix( 1.0, shadow, shadowIntensity );', mark);
  const end = ret < 0 ? -1 : chunk.indexOf('}', ret) + 1;
  if (mark < 0 || start < 0 || end <= 0) {
    console.warn('Simflate: soft shadow not applied (three.js shadow code changed)');
    return chunk;
  }
  const area = `

		uniform float uSoft;

		float bsNoise( vec2 p ) {
			return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
		}

		vec2 bsDisk( int i, int n, float phi ) {
			float r = sqrt( ( float( i ) + 0.5 ) / float( n ) );
			float t = float( i ) * 2.399963229728653 + phi;
			return vec2( cos( t ), sin( t ) ) * r;
		}

		float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord ) {
			float shadow = 1.0;
			shadowCoord.xyz /= shadowCoord.w;
			shadowCoord.z += shadowBias;
			bool inFrustum = shadowCoord.x >= 0.0 && shadowCoord.x <= 1.0 && shadowCoord.y >= 0.0 && shadowCoord.y <= 1.0;
			if ( inFrustum && shadowCoord.z <= 1.0 ) {
				float phi = bsNoise( gl_FragCoord.xy ) * 6.2831853;
				float zR = shadowCoord.z;
				float search = min( zR * uSoft, 0.12 );
				float sum = 0.0;
				float n = 0.0;
				for ( int i = 0; i < 16; i ++ ) {
					float d = texture2D( shadowMap, shadowCoord.xy + bsDisk( i, 16, phi ) * search ).r;
					if ( d < zR ) { sum += d; n += 1.0; }
				}
				if ( n > 0.0 ) {
					float rad = max( ( zR - sum / n ) * uSoft, 1.5 / shadowMapSize.x );
					float lit = 0.0;
					for ( int i = 0; i < 32; i ++ ) {
						lit += step( zR, texture2D( shadowMap, shadowCoord.xy + bsDisk( i, 32, phi ) * rad ).r );
					}
					shadow = lit / 32.0;
				}
			}
			return mix( 1.0, shadow, shadowIntensity );
		}

	`;
  return chunk.slice(0, start) + area + chunk.slice(end);
}

/** Ground colour before a background is known. */
const FLOOR_DARK = 0x12151a;

/** Outside Render the piece lies flat (the geometry position is Render's). */
const FLAT_VIEW = { tilt: 0, spin: 0, floor: false, softness: 0.5 };

/** Camera in front of the placed piece: looking down on a flat one,
 *  straight at an upright one, in between for a tilt. */
function frameCamera(s: Scene, tilt: number) {
  const c = s.centre;
  const r = s.size;
  const u = tilt / 90;
  s.controls.target.copy(c);
  s.camera.position.set(c.x + r * (0.55 - 0.25 * u), c.y - r * (1.35 + 0.75 * u), c.z + r * (0.95 - 0.8 * u));
}

/** The floor disc's colour on a background: the same, lifted a little (as
 *  seen, not in light units — that made it mid-grey) when it's dark so a
 *  black shadow still shows on it. */
function floorColour(css: string): THREE.Color {
  const seen = new THREE.Color(css).convertLinearToSRGB();
  const lum = 0.2126 * seen.r + 0.7152 * seen.g + 0.0722 * seen.b;
  if (lum < 0.25) seen.lerp(new THREE.Color(1, 1, 1), 0.06);
  return seen.convertSRGBToLinear();
}

/** Alpha for the floor disc: solid over most of it, fading out at the rim. */
function floorTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgb(255,255,255)');
  grad.addColorStop(0.45, 'rgb(255,255,255)');
  grad.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(c);
}

/** Alpha for the contact shadow: dark in the middle, fading softly out. */
function shadowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgb(255,255,255)');
  grad.addColorStop(0.35, 'rgb(150,150,150)');
  grad.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

/** The first solid background colour behind an element. */
export function backgroundOf(el: Element | null): string {
  for (let e = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(c)) return c;
  }
  return '#060708';
}

/** Grab the current view as a PNG data URL. */
export function snapshot(): string | null {
  const c = document.querySelector('.viewport3d canvas') as HTMLCanvasElement | null;
  return c ? c.toDataURL('image/png') : null;
}
