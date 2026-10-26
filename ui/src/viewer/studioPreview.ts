// Little chrome balls showing each studio, for the studio list.
// One small offscreen renderer, one preview at a time, cached by studio.

import * as THREE from 'three';
import { gradientTexture, studioScene, type StudioDef } from './studio';

const PX = 112;
let kit: { renderer: THREE.WebGLRenderer; pmrem: THREE.PMREMGenerator; scene: THREE.Scene; camera: THREE.PerspectiveCamera } | null = null;

function setup() {
  if (kit) return kit;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(PX, PX, false);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = new THREE.Scene();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 32),
    new THREE.MeshPhysicalMaterial({ color: 0xe2e4e8, metalness: 1, roughness: 0.04 }),
  );
  scene.add(ball);
  // Same direction as the viewer's starting camera: from the front, raised.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.up.set(0, 0, 1);
  camera.position.set(0.55, -1.35, 0.95).setLength(4.2);
  camera.lookAt(0, 0, 0);
  kit = { renderer, pmrem, scene, camera };
  return kit;
}

const cache = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

/** A data-URL picture of a chrome ball in this studio. */
export function studioPreview(def: StudioDef): Promise<string> {
  const key = `${def.id}|${def.hdri ?? ''}`;
  let p = cache.get(key);
  if (!p) {
    const job = queue.then(async () => {
      const k = setup();
      const room = await studioScene(def, 0, 0, 0.5);
      const rt = k.pmrem.fromScene(room, def.id === 'studio' ? 0.04 : 0, 0.1, 100, { size: 256 });
      k.scene.environment = rt.texture;
      const bg = gradientTexture(def.backdrop[0], def.backdrop[1]);
      k.scene.background = bg;
      k.renderer.toneMapping = def.id === 'studio' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
      k.renderer.toneMappingExposure = def.exposure;
      k.renderer.render(k.scene, k.camera);
      const url = k.renderer.domElement.toDataURL('image/png');
      rt.dispose();
      bg.dispose();
      return url;
    });
    // One failure (a bad file) mustn't stall the rest.
    queue = job.catch(() => undefined);
    p = job;
    cache.set(key, p);
  }
  return p;
}
