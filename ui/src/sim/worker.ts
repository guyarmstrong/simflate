/// <reference lib="webworker" />
// Runs the Rust solver (WebAssembly) off the UI thread and streams frames.

interface Exports {
  memory: WebAssembly.Memory;
  bs_alloc(len: number): number;
  bs_free(ptr: number, len: number): void;
  bs_result_ptr(): number;
  bs_result_len(): number;
  bs_create(ptr: number, len: number): number;
  bs_step(): number;
  bs_raise_pressure(p: number): number;
  bs_raise_height(h: number): number;
  bs_vertex_count(): number;
  bs_positions_ptr(): number;
  bs_index_count(): number;
  bs_indices_ptr(): number;
  bs_uv_ptr(): number;
  bs_weld_ptr(): number;
  bs_field(kind: number): number;
  bs_input_ptr(len: number): number;
  bs_adopt_mesh(ptr: number, len: number): number;
  bs_finish(levels: number, iterations: number, creaseDeg: number, edgeRipples: number, weldFilletMm: number, ridges: number, showThickness: number): number;
  bs_render_positions_ptr(): number;
  bs_render_indices_ptr(): number;
  bs_render_uv_ptr(): number;
  bs_render_origin_ptr(): number;
}

export type ToWorker =
  | { type: 'start'; pieces: unknown; settings: unknown; meshOnly?: boolean }
  /** A native run started: build the same piece and settings for the finisher, quietly. */
  | { type: 'prepare'; pieces: unknown; settings: unknown }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'raisePressure'; value: number }
  | { type: 'raiseHeight'; value: number }
  /** A snapshot whose outline no longer re-meshes to the same points: finish its own mesh. */
  | { type: 'adopt'; indices: Uint32Array; uv: Float32Array; weld: Uint8Array; topTriangles: number }
  | { type: 'finish'; frame: number; positions: Float32Array; levels: number; iterations: number; creaseDeg: number; ripples: number; fillet: number; ridges: number; thick: boolean };

export type FromWorker =
  | { type: 'mesh'; run: number; vertexCount: number; indices: Uint32Array; uv: Float32Array; weld: Uint8Array; summary: any }
  | { type: 'frame'; run: number; positions: Float32Array; crease: Float32Array; contact: Float32Array; info: any }
  | { type: 'settled'; run: number }
  | { type: 'raised'; run: number; ok: boolean; what: 'pressure' | 'height' }
  | { type: 'error'; run: number; message: string }
  | { type: 'finishFailed'; run: number }
  | { type: 'adopted'; ok: boolean }
  | {
      type: 'finished';
      run: number;
      frame: number;
      levels: number;
      ripples: number;
      fillet: number;
      ridges: number;
      thick: boolean;
      positions: Float32Array;
      indices: Uint32Array;
      uv: Float32Array;
      origin: Uint32Array;
      topTriangles: number;
    };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
let ex: Exports | null = null;
let run = 0;
let paused = false;
let running = false;
let wake = false;

async function load(): Promise<Exports> {
  if (ex) return ex;
  const res = await fetch(new URL('/blown_wasm.wasm', ctx.location.origin));
  if (!res.ok) throw new Error('Solver file missing — run "npm run wasm" first');
  const { instance } = await WebAssembly.instantiate(await res.arrayBuffer(), {});
  ex = instance.exports as unknown as Exports;
  return ex;
}

function resultText(e: Exports): string {
  return new TextDecoder().decode(new Uint8Array(e.memory.buffer, e.bs_result_ptr(), e.bs_result_len()));
}

function copyF32(e: Exports, ptr: number, len: number): Float32Array {
  return new Float32Array(e.memory.buffer, ptr, len).slice();
}

function post(msg: FromWorker, transfer: Transferable[] = []) {
  ctx.postMessage(msg, transfer);
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

const CRASHED = 'The solver hit an internal error on this shape and has been restarted. Press Re-run to try again — and please tell Claude which shape did this.';

/** An error inside the WebAssembly (a Rust panic) leaves it unusable: its
 *  state stays locked, so every later call fails too. Drop it; the next
 *  call loads a fresh copy. Returns the message to show. */
function recover(err: unknown): string {
  if (err instanceof WebAssembly.RuntimeError) {
    ex = null;
    running = false;
    return CRASHED;
  }
  return String((err as Error)?.message ?? err);
}

function sendFrame(e: Exports, id: number, info: any) {
  const n = e.bs_vertex_count();
  const positions = copyF32(e, e.bs_positions_ptr(), n * 3);
  const crease = copyF32(e, e.bs_field(0), n);
  const contact = copyF32(e, e.bs_field(1), n);
  post({ type: 'frame', run: id, positions, crease, contact, info }, [positions.buffer, crease.buffer, contact.buffer]);
}

async function loop(id: number) {
  const e = await load();
  running = true;
  try {
    await steps(e, id);
  } catch (err) {
    // Not caught anywhere else: a stuck `running` made the next start wait for ever.
    post({ type: 'error', run: id, message: recover(err) });
  }
  running = false;
}

async function steps(e: Exports, id: number) {
  while (id === run) {
    if (paused) {
      await tick();
      await new Promise((r) => setTimeout(r, 30));
      continue;
    }
    const status = e.bs_step();
    if (id !== run) break;
    if (status < 0) break;
    sendFrame(e, id, JSON.parse(resultText(e)));
    if (status === 0) {
      post({ type: 'settled', run: id });
      // Stay alive: a later pressure raise continues the run.
      while (id === run && !wake) await new Promise((r) => setTimeout(r, 30));
      wake = false;
      continue;
    }
    await tick();
  }
}

ctx.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const msg = ev.data;
  try {
    switch (msg.type) {
      case 'start': {
        run += 1;
        const id = run;
        paused = false;
        wake = false;
        const e = await load();
        const bytes = new TextEncoder().encode(JSON.stringify({ pieces: msg.pieces, settings: msg.settings }));
        const ptr = e.bs_alloc(bytes.length);
        new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
        const ok = e.bs_create(ptr, bytes.length);
        e.bs_free(ptr, bytes.length);
        const text = resultText(e);
        if (!ok) {
          post({ type: 'error', run: id, message: text });
          return;
        }
        const vertexCount = e.bs_vertex_count();
        const ic = e.bs_index_count();
        const indices = new Uint32Array(e.memory.buffer, e.bs_indices_ptr(), ic).slice();
        const uv = copyF32(e, e.bs_uv_ptr(), vertexCount * 2);
        const weld = new Uint8Array(e.memory.buffer, e.bs_weld_ptr(), vertexCount).slice();
        const summary = JSON.parse(text);
        post({ type: 'mesh', run: id, vertexCount, indices, uv, weld, summary }, [indices.buffer, uv.buffer, weld.buffer]);
        sendFrame(e, id, summary.info);
        // The Reference solver only needs the mesh (it runs outside, see simStore).
        if (msg.meshOnly) break;
        // Wait for any previous loop to notice it has been superseded.
        while (running) await tick();
        void loop(id);
        break;
      }
      case 'prepare': {
        run += 1;
        const e = await load();
        const bytes = new TextEncoder().encode(JSON.stringify({ pieces: msg.pieces, settings: msg.settings }));
        const ptr = e.bs_alloc(bytes.length);
        new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
        e.bs_create(ptr, bytes.length);
        e.bs_free(ptr, bytes.length);
        break;
      }
      case 'pause':
        paused = true;
        break;
      case 'resume':
        paused = false;
        break;
      case 'stop':
        run += 1;
        break;
      case 'adopt': {
        const e = await load();
        const { indices, uv, weld, topTriangles } = msg;
        const bytes = new TextEncoder().encode(JSON.stringify({ indices: Array.from(indices), uv: Array.from(uv), weld: Array.from(weld), topTriangles }));
        const ptr = e.bs_alloc(bytes.length);
        new Uint8Array(e.memory.buffer, ptr, bytes.length).set(bytes);
        const ok = !!e.bs_adopt_mesh(ptr, bytes.length);
        e.bs_free(ptr, bytes.length);
        post({ type: 'adopted', ok });
        break;
      }
      case 'finish': {
        const e = await load();
        const ptr = e.bs_input_ptr(msg.positions.length);
        new Float32Array(e.memory.buffer, ptr, msg.positions.length).set(msg.positions);
        if (!e.bs_finish(msg.levels, msg.iterations, msg.creaseDeg, msg.ripples, msg.fillet, msg.ridges, msg.thick ? 1 : 0)) {
          post({ type: 'finishFailed', run });
          break;
        }
        const info = JSON.parse(resultText(e));
        const positions = copyF32(e, e.bs_render_positions_ptr(), info.vertexCount * 3);
        const uv = copyF32(e, e.bs_render_uv_ptr(), info.vertexCount * 2);
        const indices = new Uint32Array(e.memory.buffer, e.bs_render_indices_ptr(), info.indexCount).slice();
        const origin = new Uint32Array(e.memory.buffer, e.bs_render_origin_ptr(), info.vertexCount).slice();
        post(
          { type: 'finished', run, frame: msg.frame, levels: msg.levels, ripples: msg.ripples, fillet: msg.fillet, ridges: msg.ridges, thick: msg.thick, positions, indices, uv, origin, topTriangles: info.topTriangles },
          [positions.buffer, uv.buffer, indices.buffer, origin.buffer],
        );
        break;
      }
      case 'raisePressure':
      case 'raiseHeight': {
        const e = await load();
        const ok = msg.type === 'raisePressure' ? e.bs_raise_pressure(msg.value) : e.bs_raise_height(msg.value);
        if (ok) wake = true;
        post({ type: 'raised', run, ok: !!ok, what: msg.type === 'raisePressure' ? 'pressure' : 'height' });
        break;
      }
    }
  } catch (err) {
    const message = recover(err);
    post(msg.type === 'finish' ? { type: 'finishFailed', run } : msg.type === 'adopt' ? { type: 'adopted', ok: false } : { type: 'error', run, message });
  }
};
