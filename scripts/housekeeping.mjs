// End-of-session checks: `npm run housekeeping`.
// Runs the tests, type check and solver build, then reports on git, CI, docs
// and stray files. Prints a ✔ / ✖ / ! summary; exits non-zero if anything fails.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, PATH: `${path.join(os.homedir(), '.cargo', 'bin')}${path.delimiter}${process.env.PATH}` };
const results = [];
const ok = (name, detail = '') => results.push(['✔', name, detail]);
const bad = (name, detail = '') => results.push(['✖', name, detail]);
const warn = (name, detail = '') => results.push(['!', name, detail]);

function run(cmd) {
  return execSync(cmd, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true });
}

function step(name, cmd, summarise = () => '') {
  process.stdout.write(`… ${name}\n`);
  try {
    const out = run(cmd);
    ok(name, summarise(out));
  } catch (e) {
    const text = `${e.stdout ?? ''}${e.stderr ?? ''}`.trim().split('\n').slice(-8).join('\n');
    bad(name, text);
  }
}

step('Rust tests (blown-core)', 'cargo test --release -p blown-core', (o) => (o.match(/test result: ok\. (\d+) passed/) ?? [])[0] ?? '');
step('TypeScript type check', 'npx tsc --noEmit -p ui');
step('Solver → WebAssembly', 'node scripts/build-wasm.mjs', (o) => o.trim().split('\n').pop());
step('CLI builds', 'cargo build --release -p blown-cli');

// Git
try {
  const branch = run('git rev-parse --abbrev-ref HEAD').trim();
  const dirty = run('git status --porcelain').trim();
  const ahead = run('git rev-list --count @{u}..HEAD').trim();
  dirty ? warn('Git: uncommitted changes', dirty.split('\n').slice(0, 12).join('\n')) : ok('Git: working tree clean', branch);
  ahead !== '0' ? warn('Git: not pushed', `${ahead} commit(s) ahead of origin`) : ok('Git: pushed');
} catch (e) {
  warn('Git', String(e.message).split('\n')[0]);
}

// CI
try {
  const ci = run('gh run list -L 3').trim();
  /failure/.test(ci) ? warn('CI: a recent build failed', ci) : ok('CI', ci.split('\n')[0] ?? '');
} catch {
  warn('CI', 'could not reach GitHub (gh)');
}

// Docs freshness
const today = new Date().toISOString().slice(0, 10);
for (const f of ['docs/BUILD_LOG.md', 'docs/HANDOFF.md']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) bad(`${f} missing`);
  else if (!fs.readFileSync(p, 'utf8').includes(today)) warn(`${f} has no entry for ${today}`, 'Update it before ending the session.');
  else ok(`${f} updated today`);
}

// Stray files
const runs = path.join(root, 'runs');
if (fs.existsSync(runs)) {
  const suite = new Set(['circle-free', 'square-free', 'lshape-free', 'surfboard-free', 'circle-plates', 'surfboard-plates', 'square-balloon', 'square-geometric', '.gitkeep']);
  const extra = fs.readdirSync(runs).filter((n) => !suite.has(n));
  extra.length ? warn('runs/: experiment leftovers', extra.join(', ')) : ok('runs/: only the test suite');
}
// Deliberately large: studio HDRIs and the bundled Reference solver pieces.
const meantBig = (f) => f.startsWith('ui/public/studio/') || f.startsWith('vendor/opencourant/') || f.startsWith('vendor/opencourant-mac/');
const big = run('git ls-files').split('\n').filter((f) => f && !meantBig(f) && fs.existsSync(path.join(root, f)) && fs.statSync(path.join(root, f)).size > 2_000_000);
big.length ? warn('Large files in git', big.join(', ')) : ok('No large files in git');

console.log('\nHousekeeping\n');
for (const [mark, name, detail] of results) {
  console.log(`${mark} ${name}${detail ? `\n    ${detail.replace(/\n/g, '\n    ')}` : ''}`);
}
process.exit(results.some((r) => r[0] === '✖') ? 1 : 0);
