// Copies the current files (no history) to the public repository
// guyarmstrong/simflate as one new commit, under GitHub's no-reply address,
// so Mac builds can run there on GitHub's free minutes for public repos.
// The private repository keeps the real history.
//   node scripts/publish-public.mjs [ref]      (default: HEAD)
// Then start a build there: gh workflow run build.yml -R guyarmstrong/simflate --ref main
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ref = process.argv[2] ?? 'HEAD';
const remote = 'https://github.com/guyarmstrong/simflate.git';
const who = { name: 'Guy Armstrong', email: '200261854+guyarmstrong@users.noreply.github.com' };
const work = path.join(os.tmpdir(), 'simflate-public');

const git = (args, cwd = work, opts = {}) => (execFileSync('git', args, { cwd, encoding: 'utf8', ...opts }) ?? '').trim();

if (git(['status', '--porcelain'], root)) console.warn('Note: uncommitted changes are not published (only committed files are).');
const sha = git(['rev-parse', '--short', ref], root);

// A clone of the public repo (or a fresh one, the first time).
fs.rmSync(work, { recursive: true, force: true });
try {
  git(['clone', '--quiet', remote, work], root);
} catch {
  fs.mkdirSync(work, { recursive: true });
  git(['init', '--quiet', '-b', 'main']);
  git(['remote', 'add', 'origin', remote]);
}
git(['config', 'user.name', who.name]);
git(['config', 'user.email', who.email]);

// Replace everything with the committed files at `ref`.
for (const f of fs.readdirSync(work)) if (f !== '.git') fs.rmSync(path.join(work, f), { recursive: true, force: true });
// (Through a throwaway index, so the private repo's own index is untouched.)
const index = { env: { ...process.env, GIT_INDEX_FILE: path.join(os.tmpdir(), 'simflate-public.index') } };
git(['read-tree', ref], root, index);
git(['checkout-index', '-a', '-f', `--prefix=${work.replaceAll('\\', '/')}/`], root, index);
fs.rmSync(index.env.GIT_INDEX_FILE, { force: true });

git(['add', '-A']);
if (!git(['status', '--porcelain'])) {
  console.log('Public repo already matches', sha);
} else {
  const version = JSON.parse(fs.readFileSync(path.join(work, 'package.json'), 'utf8')).version;
  git(['commit', '--quiet', '-m', `Simflate ${version} (${sha})`]);
  git(['push', '--quiet', '-u', 'origin', 'main'], work, { stdio: 'inherit' });
  console.log(`Published ${sha} → ${remote}`);
}
