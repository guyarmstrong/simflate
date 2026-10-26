// Simulation state on the UI side: the mesh, every frame (for scrubbing),
// and controls that talk to the solver worker.

import { create } from 'zustand';
import type { FromWorker, ToWorker } from './worker';
import { isDesktop } from '../io/files';

export interface FrameInfo {
  frame: number;
  time: number;
  pressure: number;
  heightMm: number;
  volumeMl: number;
  contactFraction: number;
  maxStretchPct: number;
  motion: number;
  status: 'running' | 'settled';
  stable: boolean;
  /** Real water pressure (Reference solver only). */
  pressureBar?: number;
}

/** How far a Reference run has got. */
export interface RefProgress {
  fraction: number;
  secondsLeft: number | null;
  phase: string;
}

export interface SimMesh {
  vertexCount: number;
  indices: Uint32Array;
  uv: Float32Array;
  weld: Uint8Array;
  topTriangles: number;
  /** Weld outlines (mm) for drawing the seam (saved runs only). */
  outline?: [number, number][][];
  /** Plate z positions (saved runs only). */
  plates?: { bottom: number; top: number } | null;
  settings?: unknown;
}

/** Smooth render mesh made by the finisher for one frame. */
export interface RenderMeshData {
  frame: number;
  levels: number;
  /** Edge ripple strength it was made with (live runs). */
  ripples?: number;
  /** Weld fillet radius it was made with (mm); the seam is real geometry. */
  fillet?: number;
  /** Ridge sharpness it was made with (0 = off). */
  ridges?: number;
  /** Sheet thickness shown on the render mesh (cut edge at the seam). */
  thick?: boolean;
  positions: Float32Array;
  indices: Uint32Array;
  uv: Float32Array;
  /** Render point → watertight point index (for OBJ export). */
  origin: Uint32Array;
  topTriangles: number;
}

export type SimStatus = 'idle' | 'meshing' | 'running' | 'paused' | 'settled' | 'error';

interface SimState {
  source: 'live' | 'run';
  runName: string | null;
  status: SimStatus;
  error: string | null;
  mesh: SimMesh | null;
  frames: Float32Array[];
  crease: Float32Array[];
  contact: Float32Array[];
  infos: FrameInfo[];
  /** Frame being shown. */
  current: number;
  /** Follow the newest frame as it arrives. */
  follow: boolean;
  playing: boolean;
  warnings: string[];
  /** Bumped when a new mesh arrives so the viewport re-frames the camera. */
  meshVersion: number;
  render: RenderMeshData | null;
  finishing: boolean;
  /** The live run is on the Reference solver (OpenCourant, desktop only). */
  reference: boolean;
  refProgress: RefProgress | null;
  /** Last message from the Reference solver (target reached, stopped…). */
  refMessage: string | null;

  setCurrent: (i: number) => void;
  setPlaying: (b: boolean) => void;
  load: (p: Partial<SimState>) => void;
}

const MAX_FRAMES = 1200;

export const useSim = create<SimState>((set) => ({
  source: 'live',
  runName: null,
  status: 'idle',
  error: null,
  mesh: null,
  frames: [],
  crease: [],
  contact: [],
  infos: [],
  current: 0,
  follow: true,
  playing: false,
  warnings: [],
  meshVersion: 0,
  render: null,
  finishing: false,
  reference: false,
  refProgress: null,
  refMessage: null,
  setCurrent: (i) =>
    set((s) => {
      const current = Math.max(0, Math.min(s.frames.length - 1, i));
      return { current, follow: current === s.frames.length - 1 };
    }),
  setPlaying: (playing) => set({ playing }),
  load: (p) => set(p),
}));

let worker: Worker | null = null;
let liveRun = 0;

// --- Reference solver (desktop app): the worker meshes, OpenCourant inflates.
/** Settings of the reference run waiting for its mesh. */
let refPending: { thicknessMm: number; character: number; pressure: number; targetHeightMm: number | null; symmetric: boolean; wavesPerEdge: number } | null = null;
let refJob = 0;
let refArea = 0;
let refListening = false;

async function invokeDesktop<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function listenReference() {
  if (refListening) return;
  refListening = true;
  const { listen } = await import('@tauri-apps/api/event');
  await listen<{ job: number; positions: number[]; info: FrameInfo }>('reference-frame', (ev) => {
    const s = useSim.getState();
    if (ev.payload.job !== refJob || !s.reference || !s.mesh) return;
    const n = s.mesh.vertexCount;
    const frames = [...s.frames, Float32Array.from(ev.payload.positions)];
    useSim.setState({
      frames,
      crease: [...s.crease, new Float32Array(n)],
      contact: [...s.contact, new Float32Array(n)],
      infos: [...s.infos, { ...ev.payload.info, frame: frames.length - 1 }],
      current: s.follow ? frames.length - 1 : s.current,
    });
  });
  await listen<{ job: number; fraction: number; secondsLeft: number | null; phase: string }>('reference-progress', (ev) => {
    if (ev.payload.job !== refJob || !useSim.getState().reference) return;
    const { fraction, secondsLeft, phase } = ev.payload;
    useSim.setState({ refProgress: { fraction, secondsLeft, phase } });
  });
  await listen<{ job: number; ok: boolean; reached: boolean; message: string }>('reference-done', (ev) => {
    if (ev.payload.job !== refJob || !useSim.getState().reference) return;
    useSim.setState(
      ev.payload.ok
        ? { status: 'settled', refProgress: null, refMessage: ev.payload.message }
        : { status: 'error', refProgress: null, error: `Reference solver: ${ev.payload.message}` },
    );
  });
}

function flatArea(pos: Float32Array, indices: Uint32Array, topTriangles: number): number {
  let a = 0;
  for (let t = 0; t < topTriangles; t++) {
    const [i, j, k] = [indices[3 * t], indices[3 * t + 1], indices[3 * t + 2]];
    a += Math.abs((pos[3 * j] - pos[3 * i]) * (pos[3 * k + 1] - pos[3 * i + 1]) - (pos[3 * k] - pos[3 * i]) * (pos[3 * j + 1] - pos[3 * i + 1])) / 2;
  }
  return a;
}

// Preparing ahead: while Reference is chosen and the piece is being set
// up, a worker of its own meshes it (the same mesh a run would get) and the
// desktop app prepares OpenCourant's model in the background, so Inflate
// starts the engines at once (Guy's test laptop: its antivirus holds the
// preparing step ~50 s every time).
let prepWorker: Worker | null = null;
let prepGen = 0;

function prepareReference(pieces: unknown, settings: unknown) {
  if (!isDesktop) return;
  const st = settings as { thicknessMm: number; character: number; pressure: number; targetHeightMm: number | null; symmetric?: boolean; wavesPerEdge?: number };
  const gen = ++prepGen;
  prepWorker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const w = prepWorker;
  let mesh: { indices: Uint32Array; weld: Uint8Array; topTriangles: number } | null = null;
  const onMsg = (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (gen !== prepGen || m.type === 'error') {
      w.removeEventListener('message', onMsg);
      return;
    }
    if (m.type === 'mesh') mesh = { indices: m.indices, weld: m.weld, topTriangles: m.summary.topTriangles };
    else if (m.type === 'frame' && mesh) {
      w.removeEventListener('message', onMsg);
      void invokeDesktop('reference_prepare', {
        req: {
          job: 0,
          positions: Array.from(m.positions),
          indices: Array.from(mesh.indices),
          weld: Array.from(mesh.weld),
          topTriangles: mesh.topTriangles,
          thicknessMm: st.thicknessMm,
          character: st.character,
          pressure: st.pressure,
          targetHeightMm: st.targetHeightMm,
          symmetric: !!st.symmetric,
          wavesPerEdge: st.wavesPerEdge ?? 0,
        },
      }).catch(() => {});
    }
  };
  w.addEventListener('message', onMsg);
  const msg: ToWorker = { type: 'start', pieces, settings, meshOnly: true };
  w.postMessage(msg);
}

/** The mesh and its flat frame are in: hand them to OpenCourant. */
async function startReference(positions: Float32Array) {
  const req = refPending;
  const mesh = useSim.getState().mesh;
  refPending = null;
  if (!req || !mesh) return;
  refJob += 1;
  refArea = flatArea(positions, mesh.indices, mesh.topTriangles);
  useSim.setState({ refProgress: { fraction: 0, secondsLeft: null, phase: 'Preparing the model' } });
  try {
    await listenReference();
    await invokeDesktop('reference_start', {
      req: {
        job: refJob,
        positions: Array.from(positions),
        indices: Array.from(mesh.indices),
        weld: Array.from(mesh.weld),
        topTriangles: mesh.topTriangles,
        thicknessMm: req.thicknessMm,
        character: req.character,
        pressure: req.pressure,
        targetHeightMm: req.targetHeightMm,
        symmetric: req.symmetric,
        wavesPerEdge: req.wavesPerEdge,
      },
    });
  } catch (e) {
    useSim.setState({ status: 'error', refProgress: null, error: `Reference solver: ${String(e)}` });
  }
}

/** Solver messages, from the worker or the native solver. */
function handle(msg: FromWorker) {
    if ('run' in msg && msg.run !== liveRun && msg.type !== 'raised') return;
    const st = useSim.getState();
    if (st.source !== 'live') return;
    switch (msg.type) {
      case 'mesh':
        useSim.setState({
          mesh: {
            vertexCount: msg.vertexCount,
            indices: msg.indices,
            uv: msg.uv,
            weld: msg.weld,
            topTriangles: msg.summary.topTriangles,
          },
          frames: [],
          crease: [],
          contact: [],
          infos: [],
          current: 0,
          follow: true,
          status: 'running',
          warnings: msg.summary.warnings ?? [],
          meshVersion: st.meshVersion + 1,
          render: null,
        });
        break;
      case 'frame': {
        const s = useSim.getState();
        let frames = [...s.frames, msg.positions];
        let crease = [...s.crease, msg.crease];
        let contact = [...s.contact, msg.contact];
        let infos = [...s.infos, msg.info as FrameInfo];
        if (frames.length > MAX_FRAMES) {
          // Keep the start, thin out the middle so scrubbing still covers the whole run.
          const keep = (_: unknown, i: number) => i === 0 || i % 2 === 0 || i >= frames.length - 50;
          frames = frames.filter(keep);
          crease = crease.filter(keep);
          contact = contact.filter(keep);
          infos = infos.filter(keep);
        }
        useSim.setState({
          frames,
          crease,
          contact,
          infos,
          current: s.follow ? frames.length - 1 : s.current,
          status: s.status === 'paused' ? 'paused' : 'running',
        });
        if (refPending && frames.length === 1) void startReference(msg.positions);
        if (msg.info && msg.info.stable === false) {
          useSim.setState({
            status: 'error',
            error: 'The solver went unstable on this shape and stopped. Try Draft mesh, a lower pressure, or tell Claude which shape did this.',
          });
        }
        break;
      }
      case 'settled':
        useSim.setState({ status: 'settled' });
        break;
      case 'raised':
        if (msg.ok) useSim.setState({ status: 'running', follow: true });
        break;
      case 'error':
        useSim.setState({ status: 'error', error: msg.message, finishing: false });
        break;
      case 'finishFailed':
        useSim.setState({ finishing: false });
        break;
      case 'finished':
        useSim.setState({
          finishing: false,
          render: {
            frame: msg.frame,
            levels: msg.levels,
            ripples: msg.ripples,
            fillet: msg.fillet,
            ridges: msg.ridges,
            thick: msg.thick,
            positions: msg.positions,
            indices: msg.indices,
            uv: msg.uv,
            origin: msg.origin,
            topTriangles: msg.topTriangles,
          },
        });
        break;
    }
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<FromWorker>) => handle(ev.data);
  worker.onerror = (e) => useSim.setState({ status: 'error', error: e.message || 'Solver crashed' });
  return worker;
}

// --- Native solver (desktop app): Fast / Steel on several cores, same
// results as the worker's WebAssembly. Mesh and frames arrive as raw bytes
// (layout in src-tauri/src/native.rs). The finisher stays in the worker.
/** The live run is on the native solver. */
let native = false;

/** Reads the byte layout written by native.rs. */
class Reader {
  off = 0;
  constructor(private buf: ArrayBuffer) {}
  u32() {
    const v = new DataView(this.buf).getUint32(this.off, true);
    this.off += 4;
    return v;
  }
  json() {
    const n = this.u32();
    const v = JSON.parse(new TextDecoder().decode(new Uint8Array(this.buf, this.off, n)));
    this.off = (this.off + n + 3) & ~3;
    return v;
  }
  f32(n: number) {
    const v = new Float32Array(this.buf.slice(this.off, this.off + n * 4));
    this.off += n * 4;
    return v;
  }
  u32s(n: number) {
    const v = new Uint32Array(this.buf.slice(this.off, this.off + n * 4));
    this.off += n * 4;
    return v;
  }
  u8(n: number) {
    const v = new Uint8Array(this.buf.slice(this.off, this.off + n));
    this.off = (this.off + n + 3) & ~3;
    return v;
  }
}

/** A frame or message from native.rs, as the worker would have sent it. */
function nativeMessage(buf: ArrayBuffer, run: number, n: number): FromWorker | null {
  const kind = new Uint8Array(buf, 0, 1)[0];
  const r = new Reader(buf);
  r.off = 4;
  const json = r.json();
  if (kind === 1) return { type: 'frame', run, info: json, positions: r.f32(n * 3), crease: r.f32(n), contact: r.f32(n) };
  if (kind === 2) return { type: 'settled', run };
  if (kind === 3) return { type: 'raised', run, ok: json.ok, what: json.what };
  return null; // 4: unstable (the frame before it already says so)
}

/** Start a Fast / Steel run natively. False if the native solver isn't there. */
async function startNative(run: number, pieces: unknown, settings: unknown): Promise<boolean> {
  try {
    const { invoke, Channel } = await import('@tauri-apps/api/core');
    let n = -1;
    const early: ArrayBuffer[] = [];
    const ch = new Channel<ArrayBuffer>();
    ch.onmessage = (buf) => {
      if (run !== liveRun) return;
      if (n < 0) return void early.push(buf); // before the mesh is in
      const m = nativeMessage(buf, run, n);
      if (m) handle(m);
    };
    const buf = await invoke<ArrayBuffer>('native_start', { request: JSON.stringify({ pieces, settings }), onEvent: ch });
    if (run !== liveRun) return true;
    const r = new Reader(buf);
    const summary = r.json();
    const vertexCount: number = summary.vertexCount;
    const indices = r.u32s(r.u32());
    const uv = r.f32(vertexCount * 2);
    const weld = r.u8(vertexCount);
    handle({ type: 'mesh', run, vertexCount, indices, uv, weld, summary });
    const first = nativeMessage(buf.slice(r.off), run, vertexCount);
    if (first) handle(first);
    n = vertexCount;
    for (const b of early.splice(0)) {
      const m = nativeMessage(b, run, n);
      if (m) handle(m);
    }
    return true;
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    // The native solver ran and found a problem with the shape: say so
    // (Sim::new's messages). Anything else: fall back to the worker.
    if (/outline|mesh|area|plates|weld/i.test(msg) && !/not found|unknown command|invoke/i.test(msg)) {
      handle({ type: 'error', run, message: msg });
      return true;
    }
    console.warn('Native solver unavailable, using WebAssembly:', msg);
    return false;
  }
}

function send(msg: ToWorker) {
  getWorker().postMessage(msg);
}

export const sim = {
  /** Reference chosen: prepare this piece's model in the background (desktop app). */
  prepareReference,
  /** `reference`: inflate on the Reference solver (desktop app) instead of the worker. */
  start(pieces: unknown, settings: unknown, reference = false) {
    liveRun += 1;
    if (useSim.getState().reference) void invokeDesktop('reference_stop').catch(() => {});
    const st = settings as { thicknessMm: number; character: number; pressure: number; targetHeightMm: number | null; symmetric?: boolean; wavesPerEdge?: number };
    refPending = reference ? { thicknessMm: st.thicknessMm, character: st.character, pressure: st.pressure, targetHeightMm: st.targetHeightMm, symmetric: !!st.symmetric, wavesPerEdge: st.wavesPerEdge ?? 0 } : null;
    useSim.setState({ source: 'live', runName: null, status: 'meshing', error: null, playing: false, reference, refProgress: null, refMessage: null });
    if (native) void invokeDesktop('native_stop').catch(() => {});
    native = false;
    if (isDesktop && !reference) {
      native = true;
      const run = liveRun;
      // The worker counts runs too (its smoothing replies carry the count):
      // keep it in step, stop anything it was running, and give its finisher
      // this run's piece and settings (thickness, soap…), not the last ones.
      send({ type: 'prepare', pieces, settings });
      void startNative(run, pieces, settings).then((ok) => {
        if (ok || run !== liveRun) return;
        native = false;
        send({ type: 'start', pieces, settings });
        liveRun += 1;
      });
      return;
    }
    send({ type: 'start', pieces, settings, meshOnly: reference });
  },
  pause() {
    // A Reference run can't pause: stopping keeps the frames so far.
    if (useSim.getState().reference) return sim.stop();
    if (native) void invokeDesktop('native_pause', { paused: true }).catch(() => {});
    else send({ type: 'pause' });
    useSim.setState({ status: 'paused' });
  },
  resume() {
    if (native) void invokeDesktop('native_pause', { paused: false }).catch(() => {});
    else send({ type: 'resume' });
    useSim.setState({ status: 'running', follow: true });
  },
  stop() {
    if (useSim.getState().reference) {
      refPending = null;
      void invokeDesktop('reference_stop').catch(() => {});
      useSim.setState({ refProgress: null, refMessage: 'Stopped.' });
    }
    liveRun += 1;
    send({ type: 'stop' });
    if (native) void invokeDesktop('native_stop').catch(() => {});
    const s = useSim.getState();
    if (s.status === 'running' || s.status === 'paused' || s.status === 'meshing') useSim.setState({ status: 'settled' });
  },
  /** Stop and take the piece off screen (its shape was changed in Draft). */
  clear() {
    sim.stop();
    useSim.setState({ status: 'idle', mesh: null, frames: [], crease: [], contact: [], infos: [], current: 0, playing: false, render: null, finishing: false, error: null, refMessage: null });
  },
  raisePressure(value: number, character = 0, thicknessMm = 1) {
    if (useSim.getState().reference) return void retarget({ pressure: value, character, thicknessMm });
    if (native) void invokeDesktop('native_raise', { pressure: value }).catch(() => {});
    else send({ type: 'raisePressure', value });
  },
  raiseHeight(value: number, character = 0, thicknessMm = 1) {
    if (useSim.getState().reference) return void retarget({ heightMm: value, character, thicknessMm });
    if (native) void invokeDesktop('native_raise', { heightMm: value }).catch(() => {});
    else send({ type: 'raiseHeight', value });
  },
  /** Ask the finisher for a smooth render mesh of one frame. */
  finish(frame: number, levels: number, ripples: number, fillet: number, ridges: number, thick: boolean) {
    const s = useSim.getState();
    const positions = s.frames[frame];
    if (!positions || s.source !== 'live') return;
    useSim.setState({ finishing: true });
    send({ type: 'finish', frame, positions: positions.slice(), levels, iterations: 4, creaseDeg: 50, ripples, fillet, ridges, thick });
  },
};

/** Raise a running Reference run's target (it stops pumping when it gets there). */
async function retarget(t: { pressure?: number; heightMm?: number; character: number; thicknessMm: number }) {
  if (useSim.getState().status !== 'running') return;
  await invokeDesktop('reference_retarget', {
    job: refJob,
    pressure: t.pressure ?? null,
    heightMm: t.heightMm ?? null,
    character: t.character,
    thicknessMm: t.thicknessMm,
    areaMm2: refArea,
  }).catch(() => {});
}
