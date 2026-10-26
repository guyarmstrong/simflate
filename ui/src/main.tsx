import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/inter';
import './styles.css';
import { useApp } from './state/store';
import { useSim } from './sim/simStore';
import { CrashBoundary, CrashWindow, installCrashHandlers } from './ui/CrashReport';
import { installLabelColumns } from './ui/controls';

declare global {
  interface Window {
    /** The start-up screen in index.html. */
    __splash?: { step: (text: string, pct?: number) => void; done: () => void; isOpen: () => boolean };
  }
}
const splash = (text: string, pct?: number) => window.__splash?.step(text, pct);

installCrashHandlers();
// The app's code is loaded and the last project restored (the store reads
// the autosave as it loads).
splash('Restoring your last project…', 45);

// Handy for debugging in the browser console.
if (import.meta.env.DEV) {
  Object.assign(window, { __app: useApp, __sim: useSim });
  if (location.search.includes('bench')) void import('./bench').then((m) => m.runBench());
}

async function start() {
  splash('Loading fonts…', 60);
  // Never wait long: the app draws fine with a stand-in font.
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
  splash('Building the workspace…', 75);
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <CrashBoundary>
        <App />
      </CrashBoundary>
      <CrashWindow />
    </StrictMode>,
  );
  installLabelColumns();
  // Two frames: React has drawn and the 3D view has had its first paint.
  requestAnimationFrame(() => {
    splash('Preparing the 3D view…', 90);
    requestAnimationFrame(() => window.__splash?.done());
  });
}

void start();
