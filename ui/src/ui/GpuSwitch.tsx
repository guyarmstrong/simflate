// Top bar, desktop app: which graphics chip draws the window — a two-way
// toggle like KeyShot's CPU | GPU: Built-in (Intel) or GPU (the NVIDIA /
// AMD card). Windows only; greyed out on a Mac, which picks the chip itself.
// The solvers run on the CPU either way; this speeds up drawing and takes
// that load off the chip that shares power with the CPU. The window's engine
// picks its chip once, when it starts, so a change applies on the next start
// (restart now, or next time) — see src-tauri/src/gpu.rs.

import { useEffect, useState } from 'react';
import { useApp } from '../state/store';
import { isDesktop } from '../io/files';

/** The chip WebGL is drawing with, e.g. "NVIDIA GeForce RTX 3070 Ti Laptop GPU". */
function rendererName(): string {
  try {
    const gl = document.createElement('canvas').getContext('webgl');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const raw = ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    // "ANGLE (NVIDIA, NVIDIA GeForce RTX 3070 Ti Laptop GPU (0x…) Direct3D11 …)" → the card's name.
    const m = raw.match(/ANGLE \([^,]*, ([^(]+?)\s*(\(0x|Direct3D|$)/);
    return (m ? m[1] : raw).trim();
  } catch {
    return '';
  }
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const core = await import('@tauri-apps/api/core');
  return core.invoke<T>(cmd, args);
}

export function GpuSwitch() {
  /** The saved choice; null = no choice on this computer (Mac). */
  const [high, setHigh] = useState<boolean | null | undefined>(undefined);
  const [chip] = useState(rendererName);
  const showToast = useApp((s) => s.showToast);

  useEffect(() => {
    if (!isDesktop) return;
    invoke<boolean | null>('gpu_get')
      .then((v) => setHigh(v ?? null))
      .catch(() => setHigh(null));
  }, []);
  if (!isDesktop || high === undefined) return null;

  const usingCard = /nvidia|geforce|radeon|amd/i.test(chip);
  const choose = async (next: boolean) => {
    if (high === null || next === high) return;
    try {
      await invoke('gpu_set', { high: next, restart: false });
    } catch (e) {
      return showToast(`Could not switch: ${String((e as Error)?.message ?? e)}`);
    }
    setHigh(next);
    if (next === usingCard) return; // back to the chip already drawing
    showToast(
      `${next ? 'GPU' : 'Built-in graphics'} chosen. It applies when Simflate next starts — restart now, or it happens next time you open it. A restart keeps your drawing and settings; save your project first if you want it as a file.`,
      { label: 'Restart now', run: () => void invoke('gpu_set', { high: next, restart: true }) },
    );
  };
  const mac = high === null;
  const pending = !mac && high !== usingCard;
  const title = mac
    ? 'On a Mac the system chooses the graphics chip itself'
    : `Which chip draws the 3D view (the solvers always run on the main processor). Drawing now with: ${chip || 'unknown'}.${pending ? ' Your choice applies when Simflate next starts.' : ''}`;
  return (
    <>
      {/* Named, so it's clear what Built-in / GPU choose (Guy). */}
      <span className="gpu-label" title={title}>
        3D display
      </span>
      <div className={`segmented small gpu-switch${mac ? ' disabled' : ''}${pending ? ' pending' : ''}`} title={title} data-testid="gpu-switch">
        <button type="button" className={!mac && !high ? 'on' : ''} disabled={mac} onClick={() => void choose(false)}>
          Built-in
        </button>
        <button type="button" className={!mac && high ? 'on' : ''} disabled={mac} onClick={() => void choose(true)}>
          GPU
        </button>
      </div>
    </>
  );
}
