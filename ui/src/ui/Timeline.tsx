// Bottom bar in the 3D views: a player over the recorded frames. Start /
// frame back / replay / frame forward / newest, and a track that fills in as
// the run goes (like a video loading), whichever solver is running. Starting
// and stopping the solver itself is the Inflate panel's job.

import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import { useSim, type FrameInfo } from '../sim/simStore';
import { useLibrary } from '../library/library';
import { fmt } from '../model/geometry';
import { useApp } from '../state/store';

interface ViewProps {
  frames: number;
  current: number;
  info?: FrameInfo;
  label: string;
  statusClass: string;
  /** How much of the whole run is recorded so far, 0–1 (1 once it's done). */
  loaded: number;
  loadedNote: string;
  /** Triangles in the mesh being shown (both sheets). */
  polygons: number;
  isPlaying: boolean;
  onToggle: () => void;
  onScrub: (i: number) => void;
}

function TimelineView({ frames, current, info, label, statusClass, loaded, loadedNote, polygons, isPlaying, onToggle, onScrub }: ViewProps) {
  // The On plates slot is there whenever plates are on (not only once touching), so nothing shifts.
  const platesOn = useApp((s) => s.settings.platesOn);
  const none = frames < 2;
  const go = (i: number) => onScrub(Math.max(0, Math.min(frames - 1, i)));
  return (
    <div className="timeline">
      <div className="transport">
        <button className="icon-btn" onClick={() => go(0)} disabled={none || current === 0} title="First frame" data-testid="first-frame">
          <SkipBack size={14} />
        </button>
        <button className="icon-btn" onClick={() => go(current - 1)} disabled={none || current === 0} title="Back one frame (←)" data-testid="frame-back">
          <ChevronLeft size={16} />
        </button>
        <button className="icon-btn play" onClick={onToggle} disabled={none && !isPlaying} title={isPlaying ? 'Pause the replay' : 'Replay the inflation from here (from the start if at the end)'} data-testid="play">
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <button className="icon-btn" onClick={() => go(current + 1)} disabled={none || current >= frames - 1} title="Forward one frame (→)" data-testid="frame-forward">
          <ChevronRight size={16} />
        </button>
        <button className="icon-btn" onClick={() => go(frames - 1)} disabled={none || current >= frames - 1} title="Newest frame" data-testid="last-frame">
          <SkipForward size={14} />
        </button>
      </div>
      <div className="scrub-track" title={loadedNote}>
        <div className="scrub-loaded" style={{ width: `${Math.max(0, Math.min(1, loaded)) * 100}%` }}>
          <input
            type="range"
            className="scrub"
            min={0}
            max={Math.max(0, frames - 1)}
            value={current}
            disabled={none}
            style={{ ['--fill' as string]: `${frames > 1 ? (current / (frames - 1)) * 100 : 0}%` }}
            onChange={(e) => onScrub(Number(e.target.value))}
            data-testid="scrub"
          />
        </div>
      </div>
      <span className={`status-pill ${statusClass}`} title={loadedNote} data-testid="run-status">
        {label}
      </span>
      <div className="stats">
        <span>
          <em>Frame</em> <b className="w-frame">{frames ? current + 1 : 0}/{frames}</b>
        </span>
        <span className="s-pressure">
          <em>Pressure</em> <b className="w-pressure">{info ? (info.pressureBar != null ? `${fmt(info.pressureBar, 2)} bar` : fmt(info.pressure, 0)) : '–'}</b>
        </span>
        <span>
          <em>Height</em> <b className="w-height">{info ? `${fmt(info.heightMm)} mm` : '–'}</b>
        </span>
        <span className="s-volume">
          <em>Volume</em> <b className="w-volume">{info ? `${fmt(info.volumeMl / 1000, 2)} L` : '–'}</b>
        </span>
        {platesOn && (
          <span className="s-plates">
            <em>On plates</em> <b className="w-plates">{info ? `${fmt(info.contactFraction * 100, 0)}%` : '–'}</b>
          </span>
        )}
        <span className="s-stretch" title="Largest permanent stretch of the sheet">
          <em>Stretch</em> <b className="w-stretch">{info ? `${fmt(info.maxStretchPct)}%` : '–'}</b>
        </span>
        <span className="s-polygons" title="Triangles in the mesh being solved (both sheets) — more is finer and slower">
          <em>Polygons</em> <b className="w-polygons">{polygons ? polygons.toLocaleString('en-GB') : '–'}</b>
        </span>
      </div>
    </div>
  );
}

/** Replays recorded frames at 30 fps while `playing` is on. */
function usePlayback(playing: boolean, step: () => boolean) {
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (!step()) clearInterval(id);
    }, 1000 / 30);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** How far a Fast / Steel run has got: most of the bar is reaching the
 *  pressure (or height) asked for, the rest is coming to rest there (motion
 *  falling to the settle level, on a log scale). */
function solverProgress(info: FrameInfo | undefined, by: 'pressure' | 'height', pressure: number, heightMm: number): number {
  if (!info) return 0;
  const reach = by === 'height' ? clamp01(info.heightMm / Math.max(heightMm, 1)) : clamp01(info.pressure / Math.max(pressure, 1));
  const rest = clamp01((Math.log10(1e-3) - Math.log10(Math.max(info.motion, 1e-12))) / (Math.log10(1e-3) - Math.log10(2e-6)));
  return 0.8 * reach + (reach > 0.98 ? 0.2 * rest : 0);
}

/** Frame step for the arrow keys (Inflate and Forms views). */
export function stepFrame(where: 'live' | 'library', d: number) {
  const s = where === 'live' ? useSim.getState() : useLibrary.getState();
  s.setPlaying(false);
  s.setCurrent(s.current + d);
}

export function LiveTimeline() {
  const frames = useSim((s) => s.frames.length);
  const current = useSim((s) => s.current);
  const info = useSim((s) => s.infos[s.current]);
  const newest = useSim((s) => s.infos[s.infos.length - 1]);
  const status = useSim((s) => s.status);
  const playing = useSim((s) => s.playing);
  const reference = useSim((s) => s.reference);
  const refProgress = useSim((s) => s.refProgress);
  const meshVersion = useSim((s) => s.meshVersion);
  const polygons = useSim((s) => (s.mesh ? s.mesh.indices.length / 3 : 0));
  const settings = useApp((s) => s.settings);
  const { setCurrent, setPlaying } = useSim.getState();

  usePlayback(playing, () => {
    const s = useSim.getState();
    if (s.current >= s.frames.length - 1) {
      // At the newest frame: keep following a live run, else stop. A
      // Reference run adds a frame a minute, so the replay stops there.
      if (s.status !== 'running' || s.reference) setPlaying(false);
      return s.status === 'running' && !s.reference;
    }
    s.setCurrent(s.current + 1);
    return true;
  });

  const running = status === 'running' || status === 'meshing';
  // The bar only grows during a run (motion can flicker back up).
  const peak = useRef({ version: -1, value: 0 });
  if (peak.current.version !== meshVersion) peak.current = { version: meshVersion, value: 0 };
  let loaded = 0;
  if (status === 'settled' || status === 'paused' || (status === 'error' && frames > 1)) loaded = 1;
  else if (running && frames) {
    const p = reference ? (refProgress?.fraction ?? 0) : solverProgress(newest, settings.inflateBy, settings.pressure, settings.heightMm);
    loaded = peak.current.value = Math.max(peak.current.value, Math.min(0.99, p));
  }
  const pct = `${Math.round(loaded * 100)}%`;
  const label =
    status === 'running'
      ? `${reference ? 'Reference' : 'Inflating'} ${pct}`
      : { idle: 'Ready', meshing: 'Meshing…', running: '', paused: 'Paused', settled: 'Settled', error: 'Error' }[status];
  const minutes = refProgress?.secondsLeft != null && refProgress.fraction > 0.02 ? ` · at most ${Math.max(1, Math.round(refProgress.secondsLeft / 60))} min left` : '';
  const loadedNote = running
    ? reference
      ? `Reference · ${refProgress?.phase ?? 'starting'} · ${pct}${minutes}`
      : `${pct} of the way: reaching the ${settings.inflateBy === 'height' ? 'target height' : 'pressure'}, then coming to rest. The bright part of the track is recorded and can be scrubbed.`
    : status === 'settled'
      ? 'The whole run is recorded: scrub or step through it.'
      : '';

  return (
    <TimelineView
      frames={frames}
      current={current}
      info={info}
      label={label}
      statusClass={status}
      loaded={frames ? loaded : 0}
      loadedNote={loadedNote}
      polygons={polygons}
      isPlaying={playing}
      onToggle={() => {
        if (playing) return setPlaying(false);
        if (current >= frames - 1) setCurrent(0);
        setPlaying(true);
      }}
      onScrub={(i) => {
        setPlaying(false);
        setCurrent(i);
      }}
    />
  );
}

export function LibraryTimeline() {
  const view = useLibrary((s) => s.view);
  const current = useLibrary((s) => s.current);
  const playing = useLibrary((s) => s.playing);
  const { setCurrent, setPlaying } = useLibrary.getState();
  const frames = view?.frames.length ?? 0;

  usePlayback(playing, () => {
    const s = useLibrary.getState();
    const n = s.view?.frames.length ?? 0;
    if (s.current >= n - 1) {
      setPlaying(false);
      return false;
    }
    s.setCurrent(s.current + 1);
    return true;
  });

  const label = !view ? 'Nothing open' : view.kind === 'snapshot' ? 'Form' : view.done ? 'Saved run' : 'Running…';
  return (
    <TimelineView
      frames={frames}
      current={current}
      info={view?.infos[current]}
      label={label}
      statusClass={view?.done === false ? 'running' : 'settled'}
      loaded={view ? 1 : 0}
      loadedNote=""
      polygons={view?.mesh ? view.mesh.indices.length / 3 : 0}
      isPlaying={playing}
      onToggle={() => {
        if (playing) return setPlaying(false);
        if (current >= frames - 1) setCurrent(0);
        setPlaying(true);
      }}
      onScrub={(i) => {
        setPlaying(false);
        setCurrent(i);
      }}
    />
  );
}
