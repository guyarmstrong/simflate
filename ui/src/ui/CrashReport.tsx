// Crash reports: one window for anything that goes wrong — the screen
// failing to draw (fatal: Reload), a stray error while working (Keep working)
// or a panic in the desktop engine (sent as the 'native-crash' event). Says
// in plain words what happened and that the autosave keeps the work, with
// the technical details to copy or save for whoever fixes it.

import { Component, useEffect, useState, type ReactNode } from 'react';
import { create } from 'zustand';
import { AlertTriangle, Copy, Download, RotateCcw } from 'lucide-react';
import { isDesktop, saveFiles } from '../io/files';
import { AUTOSAVE_KEY } from '../state/store';

interface Crash {
  /** The screen can't go on: only Reload. */
  fatal: boolean;
  where: string;
  message: string;
  detail: string;
  time: string;
}

const useCrash = create<{ crash: Crash | null }>(() => ({ crash: null }));

/** Errors that are noise, not faults (the browser's own resize warning). */
const IGNORED = [/ResizeObserver loop/i];

export function reportCrash(err: unknown, where: string, fatal = false) {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err));
  if (IGNORED.some((r) => r.test(e.message))) return;
  // The first report stays on screen; a fatal one replaces a non-fatal one.
  const now = useCrash.getState().crash;
  if (now && (now.fatal || !fatal)) return;
  const crash = { fatal, where, message: e.message || 'Unknown error', detail: e.stack ?? '', time: new Date().toISOString() };
  useCrash.setState({ crash });
  // Kept with the engine's reports (logo → About & diagnostics). The engine saves its own.
  if (isDesktop && where !== 'Engine') {
    void import('@tauri-apps/api/core').then(({ invoke }) => invoke('diag_save_report', { text: reportText(crash) })).catch(() => undefined);
  }
}

/** Catch stray errors anywhere in the page and engine panics (desktop). */
export function installCrashHandlers() {
  window.addEventListener('error', (ev) => reportCrash(ev.error ?? ev.message, 'Screen'));
  window.addEventListener('unhandledrejection', (ev) => reportCrash(ev.reason, 'Screen (background task)'));
  if (isDesktop) {
    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<string>('native-crash', (ev) => {
        // First line: the error; the rest: the engine's report.
        const [first, ...rest] = ev.payload.split('\n');
        const e = new Error(first);
        e.stack = rest.join('\n');
        reportCrash(e, 'Engine');
      }).then(() => undefined),
    );
  }
}

function reportText(c: Crash): string {
  return [
    `Simflate crash report — v${import.meta.env.VITE_APP_VERSION} (${import.meta.env.VITE_APP_SEMVER})`,
    `Time: ${c.time}`,
    `Where: ${c.where}${c.fatal ? ' (screen stopped)' : ''}`,
    `App: ${isDesktop ? 'desktop' : 'browser'} · ${navigator.userAgent}`,
    `Screen: ${window.innerWidth} × ${window.innerHeight} @ ${window.devicePixelRatio}x`,
    '',
    `Error: ${c.message}`,
    '',
    c.detail,
  ].join('\n');
}

/** Way out of a crash that comes back on every reload (something in the
 *  autosaved drawing): keep a copy of the autosave, then reload without it. */
function reloadEmpty() {
  try {
    const saved = localStorage.getItem(AUTOSAVE_KEY);
    if (saved) localStorage.setItem(`${AUTOSAVE_KEY}.before-crash`, saved);
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Storage blocked: a plain reload is all that's left.
  }
  location.reload();
}

/** The crash window, over everything (also over the start-up screen). */
export function CrashWindow() {
  const crash = useCrash((s) => s.crash);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => {
    setOpen(false);
    setNote('');
  }, [crash]);
  if (!crash) return null;
  const text = reportText(crash);
  return (
    <div className="crash-backdrop" role="alertdialog" aria-labelledby="crash-title" data-testid="crash-window">
      <div className="crash-box">
        <div className="crash-head">
          <AlertTriangle size={20} />
          <h2 id="crash-title">{crash.fatal ? 'Simflate hit a problem and has to reload' : 'Something went wrong'}</h2>
        </div>
        <p>
          {crash.where === 'Engine' ? 'The engine behind the solver stopped on an error.' : 'Part of the app stopped on an error.'} Your drawing and settings are saved automatically —{' '}
          {crash.fatal ? 'reloading brings them back. If this window comes straight back after reloading, choose Empty board (a copy of the drawing is kept).' : 'you can keep working, or reload to start the screen afresh.'}
        </p>
        <p className="crash-msg">{crash.message}</p>
        <p className="muted small">Please send the report to whoever looks after Simflate (copy it into an email, or save it as a file).</p>
        <button className="disclosure" onClick={() => setOpen(!open)}>
          {open ? 'Hide' : 'Show'} details
        </button>
        {open && <pre className="crash-detail">{text}</pre>}
        <div className="crash-actions">
          <button
            className="btn"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(
                () => setNote('Copied.'),
                () => setNote('Could not copy — use Save report.'),
              );
            }}
          >
            <Copy size={14} /> Copy report
          </button>
          <button
            className="btn"
            onClick={() => {
              void saveFiles([{ name: `simflate-crash-${crash.time.slice(0, 19).replace(/[:T]/g, '-')}.txt`, data: text, type: 'text/plain' }]).then(
                (where) => where && setNote(`Saved to ${where}.`),
                () => setNote('Could not save the report.'),
              );
            }}
          >
            <Download size={14} /> Save report
          </button>
          <span className="crash-note">{note}</span>
          <span className="crash-gap" />
          {!crash.fatal && (
            <button className="btn" onClick={() => useCrash.setState({ crash: null })}>
              Keep working
            </button>
          )}
          {crash.fatal && (
            <button className="btn" onClick={reloadEmpty} title="If Reload brings this window straight back: start with an empty board. A copy of the last drawing is kept.">
              Empty board
            </button>
          )}
          <button className="btn primary" onClick={() => location.reload()}>
            <RotateCcw size={14} /> Reload
          </button>
        </div>
      </div>
    </div>
  );
}

/** Catches errors while drawing the app: the crash window instead of a blank screen. */
export class CrashBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    const e = error instanceof Error ? error : new Error(String(error));
    if (info.componentStack) e.stack = `${e.stack ?? ''}\n\nIn:${info.componentStack}`;
    reportCrash(e, 'Screen', true);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
