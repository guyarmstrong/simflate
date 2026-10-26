// Recent projects (File → Open recent, and the empty board): the last few
// projects opened or saved, newest first. The desktop app keeps their paths;
// the browser version has no paths, so it keeps a copy of each project.

import { create } from 'zustand';
import { isDesktop } from './files';

export interface RecentProject {
  /** Desktop: the file's full path. Browser: the file name. */
  path: string;
  name: string;
  rev: string;
  /** When it was last opened or saved (ISO). */
  when: string;
  /** Browser only: the project itself. */
  text?: string;
}

const KEY = 'blownsim.recent.v1';
const MAX = 10;
/** Browser copies bigger than this aren't kept (storage is small). */
const MAX_TEXT = 400_000;

function load(): RecentProject[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((r) => r && typeof r.path === 'string') : [];
  } catch {
    return [];
  }
}

function store(list: RecentProject[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full or blocked — the list is a convenience.
  }
}

const same = (a: string, b: string) => (isDesktop ? a.toLowerCase() === b.toLowerCase() : a === b);

export const useRecent = create<{ list: RecentProject[] }>(() => ({ list: load() }));

/** Put a project at the top of the list. */
export function rememberRecent(path: string, name: string, rev: string, text?: string) {
  const entry: RecentProject = { path, name, rev, when: new Date().toISOString() };
  if (!isDesktop && text && text.length < MAX_TEXT) entry.text = text;
  const list = [entry, ...useRecent.getState().list.filter((r) => !same(r.path, path))].slice(0, MAX);
  store(list);
  useRecent.setState({ list });
}

export function forgetRecent(path: string) {
  const list = useRecent.getState().list.filter((r) => !same(r.path, path));
  store(list);
  useRecent.setState({ list });
}

export function clearRecent() {
  store([]);
  useRecent.setState({ list: [] });
}

/** The project's text, or throws if the file has gone. */
export async function readRecent(r: RecentProject): Promise<string> {
  if (!isDesktop) {
    if (r.text) return r.text;
    throw new Error(`${r.name} Rev ${r.rev} wasn't kept in this browser — open it with File → Open.`);
  }
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_project', { path: r.path });
}

/** "today 14:05", "yesterday", "3 days ago", "12 Oct". */
export function whenText(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return `today ${d.toTimeString().slice(0, 5)}`;
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The folder a recent project is in, shortened ("…\Clients\Full Blown"). */
export function folderText(path: string): string {
  const parts = path.split(/[\\/]/).slice(0, -1);
  if (!parts.length) return '';
  return parts.length > 3 ? `…\\${parts.slice(-2).join('\\')}` : parts.join('\\');
}
