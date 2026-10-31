// The Reference solver (OpenCourant) ships inside the installers, from the
// exact copy Simflate was tested with — never downloaded at build or install
// time.
//
//   node scripts/opencourant.mjs pack [folder]   (once, by hand)
//     Takes the parts BlownSim uses from an OpenCourant install (default
//     ~/OpenCourant/OpenCourant), packs them into vendor/opencourant/ as
//     gzip'd tar pieces under GitHub's 100 MB file limit, with a manifest of
//     SHA-256 sums for every piece and every file.
//
//   node scripts/opencourant.mjs pack --mac <folder>   (once, by hand)
//     Same for the Mac, into vendor/opencourant-mac/, from the artifact of our
//     Mac build (github.com/guyarmstrong/opencourant-mac, workflow macOS
//     build): exec/ with its bundled libraries, hm_cfg_files/, COPYRIGHT.md,
//     BUILD.txt. Programs get chip-neutral names (one universal set).
//
//   node scripts/opencourant.mjs unpack          (before every build)
//     Checks the pieces against the manifest, unpacks them into
//     src-tauri/resources/opencourant/ and checks every file again. Any
//     mismatch stops the build. On a Mac with nothing packed yet it leaves
//     that folder empty: the app then says Reference is Windows only.

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'src-tauri', 'resources', 'opencourant');
const PIECE = 90 * 1024 * 1024;

const WINDOWS = {
  vendor: path.join(root, 'vendor', 'opencourant'),
  /** An OpenCourant install has this. */
  marker: 'exec/engine_win64.exe',
  /** What BlownSim runs (see crates/blown-ref): starter, engine, VTK converter,
   *  their libraries and config files, and the licences that go with them. */
  keep: [
    'COPYRIGHT.md',
    'licenses',
    // Single precision, several copies at once (MPI): same piece as double
    // precision to 0.01 mm, much faster. One copy also runs through it.
    'exec/starter_win64_sp.exe',
    'exec/engine_win64_impi_sp.exe',
    'exec/anim_to_vtk_win64.exe',
    'extlib/h3d/lib/win64',
    'extlib/hm_reader/win64',
    'extlib/intelOneAPI_runtime/win64',
    'hm_cfg_files',
  ],
  /** Renamed on unpacking (same file): the engine's four copies show in Task
   *  Manager as Simflate's (crates/blown-ref BRANDED_ENGINE). */
  renamed: { 'exec/engine_win64_impi_sp.exe': 'exec/Simflate Reference engine.exe' },
  release: () => 'latest-20261011, OpenCourant_win64.zip (sha256 6d0ea8b43b68aa12f0a2787b339384a554978cbb65a5d3dbaf1e40598f02e7e6)',
};

const MAC = {
  vendor: path.join(root, 'vendor', 'opencourant-mac'),
  marker: 'exec/starter_macosa64_gf_sp',
  // exec/ holds the three programs and the libraries bundle_deps.sh put
  // beside them (@executable_path); its .src notes are left out below.
  keep: ['COPYRIGHT.md', 'exec', 'hm_cfg_files'],
  /** Renamed on packing: the names crates/blown-ref looks for on any Mac. */
  packNames: {
    'exec/starter_macosa64_gf_sp': 'exec/starter_macos_sp',
    'exec/engine_macosa64_gf_sp': 'exec/Simflate Reference engine',
    'exec/anim_to_vtk_macosa64': 'exec/anim_to_vtk_macos',
  },
  renamed: {},
  release: (src) => (fs.existsSync(path.join(src, 'BUILD.txt')) ? fs.readFileSync(path.join(src, 'BUILD.txt'), 'utf8').trim() : 'our Mac build (no BUILD.txt)'),
};

/** Plain-text files kept next to the pieces and copied in on unpacking. */
const NOTES = ['LICENSE.md', 'SOURCE.md'];

const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

function walk(dir, base = dir, list = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, list);
    else list.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return list;
}

// Windows' own tar (bsdtar), not Git's GNU tar (which reads "C:" as a host).
const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';

function pack(P, src) {
  if (!fs.existsSync(path.join(src, P.marker))) throw new Error(`No OpenCourant at ${src} (no ${P.marker})`);
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-pack-'));
  const tree = path.join(stage, 'opencourant');
  for (const item of P.keep) {
    const from = path.join(src, item);
    if (!fs.existsSync(from)) throw new Error(`Missing in the install: ${item}`);
    fs.cpSync(from, path.join(tree, item), { recursive: true });
  }
  fs.rmSync(path.join(tree, 'exec', '.src'), { recursive: true, force: true });
  for (const [from, to] of Object.entries(P.packNames ?? {})) fs.renameSync(path.join(tree, from), path.join(tree, to));
  const files = Object.fromEntries(walk(tree).sort().map((f) => [f, sha(path.join(tree, f))]));
  const archive = path.join(stage, 'opencourant.tar.gz');
  execFileSync(tar, ['-czf', archive, '-C', tree, '.'], { stdio: 'inherit' });

  fs.mkdirSync(P.vendor, { recursive: true });
  for (const f of fs.readdirSync(P.vendor)) if (f.startsWith('opencourant.tar.gz.')) fs.rmSync(path.join(P.vendor, f));
  const data = fs.readFileSync(archive);
  const pieces = [];
  for (let i = 0, k = 0; i < data.length; i += PIECE, k++) {
    const name = `opencourant.tar.gz.${String(k).padStart(3, '0')}`;
    const chunk = data.subarray(i, i + PIECE);
    fs.writeFileSync(path.join(P.vendor, name), chunk);
    pieces.push({ name, bytes: chunk.length, sha256: crypto.createHash('sha256').update(chunk).digest('hex') });
  }
  const manifest = {
    what: 'OpenCourant (community continuation of OpenRadioss), the parts BlownSim runs',
    source: src,
    release: P.release(src),
    licence: 'AGPL-3.0-or-later (COPYRIGHT.md, licenses/)',
    packed: new Date().toISOString(),
    archive: { bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') },
    pieces,
    files,
  };
  fs.writeFileSync(path.join(P.vendor, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  fs.rmSync(stage, { recursive: true, force: true });
  const mb = (n) => (n / 1048576).toFixed(0);
  console.log(`OpenCourant packed: ${Object.keys(files).length} files → ${pieces.length} pieces, ${mb(data.length)} MB in ${path.relative(root, P.vendor)}`);
}

function unpack(P) {
  const mac = P === MAC;
  if (mac && !fs.existsSync(path.join(P.vendor, 'manifest.json'))) {
    fs.rmSync(out, { recursive: true, force: true });
    fs.mkdirSync(out, { recursive: true });
    // Something in the folder, so the installer's resources entry still resolves.
    fs.writeFileSync(path.join(out, 'README.txt'), 'The Reference engine is not in this build of Simflate.\n');
    console.log('No Mac OpenCourant packed yet: the Mac app is built without Reference.');
    return;
  }
  const onDisk = (f) => P.renamed[f] ?? f;
  const manifest = JSON.parse(fs.readFileSync(path.join(P.vendor, 'manifest.json'), 'utf8'));
  // Already unpacked and intact? Then nothing to do.
  if (fs.existsSync(out) && Object.entries(manifest.files).every(([f, h]) => fs.existsSync(path.join(out, onDisk(f))) && sha(path.join(out, onDisk(f))) === h)) {
    for (const f of NOTES) fs.copyFileSync(path.join(P.vendor, f), path.join(out, f));
    console.log('OpenCourant already unpacked and checked.');
    return;
  }
  const parts = manifest.pieces.map((p) => {
    const buf = fs.readFileSync(path.join(P.vendor, p.name));
    const h = crypto.createHash('sha256').update(buf).digest('hex');
    if (h !== p.sha256) throw new Error(`${p.name} does not match the manifest — refusing to build`);
    return buf;
  });
  const data = Buffer.concat(parts);
  if (crypto.createHash('sha256').update(data).digest('hex') !== manifest.archive.sha256) throw new Error('OpenCourant archive does not match the manifest');
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-unpack-'));
  const archive = path.join(stage, 'opencourant.tar.gz');
  fs.writeFileSync(archive, data);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  execFileSync(tar, ['-xzf', archive, '-C', out], { stdio: 'inherit' });
  fs.rmSync(stage, { recursive: true, force: true });
  for (const [f, h] of Object.entries(manifest.files)) {
    if (sha(path.join(out, f)) !== h) throw new Error(`Unpacked ${f} does not match the manifest`);
  }
  for (const [f, to] of Object.entries(P.renamed)) fs.renameSync(path.join(out, f), path.join(out, to));
  // Packed on Windows, which keeps no "runnable" mark: programs and libraries
  // in exec/ get it back here.
  if (mac) for (const f of fs.readdirSync(path.join(out, 'exec'))) fs.chmodSync(path.join(out, 'exec', f), 0o755);
  // The AGPL text and where the source is (kept beside the pieces, not inside).
  for (const f of NOTES) fs.copyFileSync(path.join(P.vendor, f), path.join(out, f));
  console.log(`OpenCourant unpacked and checked: ${Object.keys(manifest.files).length} files → src-tauri/resources/opencourant`);
}

const args = process.argv.slice(2);
const forMac = args.includes('--mac');
const [cmd, arg] = args.filter((a) => a !== '--mac');
if (cmd === 'pack' && forMac) {
  if (!arg) throw new Error('pack --mac needs the folder of the Mac build');
  pack(MAC, arg);
} else if (cmd === 'pack') pack(WINDOWS, arg ?? path.join(os.homedir(), 'OpenCourant', 'OpenCourant'));
else if (cmd === 'unpack') unpack(process.platform === 'darwin' ? MAC : WINDOWS);
else {
  console.error('Usage: node scripts/opencourant.mjs pack [folder] | pack --mac <folder> | unpack');
  process.exit(1);
}
