// Claude's own test server (port 1499) beside Guy's running app: same app,
// but its own dependency cache, so it never re-optimises (and reloads) the
// cache Guy's `tauri dev` uses.
//   npx vite --config scripts/vite-isolated.config.mjs --strictPort
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import base from '../vite.config.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export default { ...base, root: path.join(root, 'ui'), cacheDir: path.join(root, 'node_modules', '.vite-isolated'), server: { ...base.server, port: 1499 } };
