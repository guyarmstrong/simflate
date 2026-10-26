// Compiles the Rust solver (crates/blown-wasm) to WebAssembly and copies it
// into ui/public so the app's solver worker can load it.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cargoHome = path.join(os.homedir(), '.cargo', 'bin');
const env = { ...process.env, PATH: `${cargoHome}${path.delimiter}${process.env.PATH}` };

execFileSync('cargo', ['build', '--release', '--target', 'wasm32-unknown-unknown', '-p', 'blown-wasm'], {
  cwd: root,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

const src = path.join(root, 'target', 'wasm32-unknown-unknown', 'release', 'blown_wasm.wasm');
const dst = path.join(root, 'ui', 'public', 'blown_wasm.wasm');
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log(`solver → ${path.relative(root, dst)} (${(fs.statSync(dst).size / 1024).toFixed(0)} KB)`);
