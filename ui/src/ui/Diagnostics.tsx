// About & diagnostics: click (or right-click) the Simflate logo. Version and
// platform, the checks built into the app (file-open check for OpenCourant's
// slow start, Reference installed, OpenCourant release) and the problem
// reports kept in the crash folder, each one to read, copy or find on disk.

import { useEffect, useState } from 'react';
import { Copy, FolderOpen } from 'lucide-react';
import { isDesktop } from '../io/files';

/** The OpenCourant shipped: their release on Windows (vendor/opencourant/manifest.json);
 *  our own build on a Mac (vendor/opencourant-mac/SOURCE.md). And our report of its slow start. */
const OC_RELEASE = /Mac/.test(navigator.userAgent) ? 'Mac build 84a0325' : 'latest-20261011';
const OC_ISSUE = 'https://github.com/OpenCourant/OpenCourant/issues/67';

interface Report {
  name: string;
  secs: number;
  first_line: string;
}
interface Diag {
  version: string;
  os: string;
  arch: string;
  reports_dir: string;
  reports: Report[];
  file_check: string[];
  reference: string | null;
}

const SHOWN = 8;
const OS: Record<string, string> = { windows: 'Windows', macos: 'Mac' };

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

async function openLink(url: string) {
  if (isDesktop) await call('open_url', { url });
  else window.open(url, '_blank', 'noopener');
}

const when = (secs: number) => new Date(secs * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

/** "1793313765 (unix s) · … · failed open 0.043 ms → OpenCourant starter loop ≈ 0.9 s · fine" → its parts. */
function fileCheck(line: string | undefined) {
  const m = line?.match(/^(\d+).*failed open ([\d.]+) ms.*≈ ([\d.]+) s · (.*)$/);
  return m ? { secs: Number(m[1]), ms: m[2], s: m[3], verdict: m[4] } : null;
}

export function DiagnosticsDialog({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<Diag | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<{ name: string; text: string } | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!isDesktop) return;
    call<Diag>('diagnostics').then(setD, (e) => setError(String(e)));
  }, []);

  const show = async (name: string) => {
    if (open?.name === name) return setOpen(null);
    try {
      setOpen({ name, text: await call<string>('diag_read', { name }) });
    } catch (e) {
      setNote(String(e));
    }
  };
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(
      () => setNote('Copied.'),
      () => setNote('Could not copy.'),
    );

  const latest = fileCheck(d?.file_check[0]);
  // Bands as in probe.rs (older lines said SLOW from 2 s: judge by the number).
  const band = !latest ? '' : Number(latest.s) < 5 ? 'fine' : Number(latest.s) < 15 ? 'noticeable' : 'slow';
  const summary = d
    ? [
        `Simflate v${import.meta.env.VITE_APP_VERSION} (${d.version}) · ${OS[d.os] ?? d.os} ${d.arch}`,
        `Reference: ${d.reference ? 'installed' : 'not in this copy'} · OpenCourant ${OC_RELEASE}`,
        `File-open check: ${d.file_check[0] ?? 'not run yet'}`,
        `Problem reports: ${d.reports.length} in ${d.reports_dir}`,
      ].join('\n')
    : '';

  return (
    <div className="dialog-backdrop dim" onPointerDown={onClose}>
      <div className="dialog diagnostics" onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()} tabIndex={-1} data-testid="diagnostics">
        <h3>About Simflate</h3>
        <div className="diag-row">
          <span>Version</span>
          <b>
            v{import.meta.env.VITE_APP_VERSION} ({import.meta.env.VITE_APP_SEMVER})
          </b>
        </div>
        <div className="diag-row">
          <span>Running on</span>
          <b>{d ? `${OS[d.os] ?? d.os} · ${d.arch}` : isDesktop ? '…' : 'Browser preview'}</b>
        </div>
        {!isDesktop && <p className="muted small">Checks and reports are in the desktop app.</p>}
        {error && <p className="check bad">{error}</p>}

        {d && (
          <>
            <h4>Checks</h4>
            <div className="diag-row" title="A few seconds after start-up Simflate times 2,000 opens of files that aren't there, as OpenCourant's starter does 20,000 times (its issue #67). Fine under 5 s, noticeable to 15 s, slow above: an antivirus checking every open.">
              <span>File-open check</span>
              <b className={band === 'slow' ? 'bad' : band === 'noticeable' ? 'warn' : 'good'}>
                {latest ? `${latest.ms} ms → starter loop ≈ ${latest.s} s · ${band}` : 'not run yet'}
              </b>
            </div>
            {latest && <div className="diag-sub">Last run {when(latest.secs)} · {d.file_check.length} kept</div>}
            <div className="diag-row">
              <span>Reference solver</span>
              <b>{d.reference ? 'Installed' : 'Not in this copy'}</b>
            </div>
            <div className="diag-row">
              <span>OpenCourant</span>
              <b>
                {OC_RELEASE} ·{' '}
                <button className="linkish" onClick={() => void openLink(OC_ISSUE)} title="Our report of the starter's slow start on antivirus laptops">
                  issue #67
                </button>
              </b>
            </div>

            <h4>Problem reports ({d.reports.length})</h4>
            {d.reports.length === 0 && <div className="diag-sub">None saved.</div>}
            <ul className="diag-reports">
              {d.reports.slice(0, SHOWN).map((r) => (
                <li key={r.name}>
                  <button className={open?.name === r.name ? 'on' : ''} onClick={() => void show(r.name)} title={r.first_line}>
                    <span className="diag-when">{when(r.secs)}</span>
                    <span className="diag-what">{r.name.includes('-screen-') ? 'Screen' : 'Engine'}: {r.first_line}</span>
                  </button>
                </li>
              ))}
            </ul>
            {d.reports.length > SHOWN && <div className="diag-sub">{d.reports.length - SHOWN} older in the folder</div>}
            {open && <pre className="crash-detail">{open.text}</pre>}
          </>
        )}

        <div className="dialog-actions">
          <span className="crash-note">{note}</span>
          <span className="crash-gap" />
          {open && (
            <button className="btn" onClick={() => copy(open.text)}>
              <Copy size={14} /> Copy report
            </button>
          )}
          {d && (
            <button className="btn" onClick={() => copy(summary)} title="Version, checks and where the reports are, for an email">
              <Copy size={14} /> Copy summary
            </button>
          )}
          {d && (
            <button className="btn" onClick={() => void call('diag_open_folder').catch((e) => setNote(String(e)))} title={d.reports_dir}>
              <FolderOpen size={14} /> Folder
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
