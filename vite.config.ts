import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const RUNS_DIR = path.resolve(__dirname, 'runs');

// The version, from package.json (the one place it's set; the installers read
// it too). Shown as v1.00: major . minor patch (docs/VERSIONS.md).
const PKG_VERSION: string = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version;
const [major, minor, patch] = PKG_VERSION.split('.');
process.env.VITE_APP_VERSION = `${major}.${minor}${patch}`;
process.env.VITE_APP_SEMVER = PKG_VERSION;

/**
 * Serves runs written by blown-cli (runs/<name>/…) to the playback viewer:
 *   GET /api/runs            → [{ name, frames, done, modified }]
 *   GET /runs/<name>/<file>  → the file
 */
function runsPlugin(): Plugin {
  return {
    name: 'blownsim-runs',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url ?? '').split('?')[0]);
        if (url === '/api/runs') {
          const list = fs.existsSync(RUNS_DIR)
            ? fs
                .readdirSync(RUNS_DIR, { withFileTypes: true })
                .filter((d) => d.isDirectory())
                .flatMap((d) => {
                  const manifest = path.join(RUNS_DIR, d.name, 'manifest.json');
                  if (!fs.existsSync(manifest)) return [];
                  try {
                    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
                    return [{ name: d.name, frames: m.frames, done: m.done, modified: fs.statSync(manifest).mtimeMs }];
                  } catch {
                    return [];
                  }
                })
                .sort((a, b) => b.modified - a.modified)
            : [];
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');
          res.end(JSON.stringify(list));
          return;
        }
        if (url === '/api/log' && req.method === 'POST') {
          // Dev-only: lets a test page report numbers back (e.g. ?bench).
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            fs.mkdirSync(RUNS_DIR, { recursive: true });
            fs.appendFileSync(path.join(RUNS_DIR, 'bench.log'), `${new Date().toISOString()} ${body}
`);
            res.end('ok');
          });
          return;
        }
        if (url.startsWith('/runs/')) {
          const file = path.resolve(RUNS_DIR, url.slice('/runs/'.length));
          if (!file.startsWith(RUNS_DIR) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            res.statusCode = 404;
            res.end();
            return;
          }
          res.setHeader('Cache-Control', 'no-store');
          if (file.endsWith('.json')) res.setHeader('Content-Type', 'application/json');
          else res.setHeader('Content-Type', 'application/octet-stream');
          fs.createReadStream(file).pipe(res);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  root: 'ui',
  publicDir: 'public',
  plugins: [react(), runsPlugin()],
  clearScreen: false,
  server: { port: 1430, strictPort: true, watch: { ignored: ['**/runs/**', '**/target/**', '**/src-tauri/**'] } },
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  worker: { format: 'es' },
});
