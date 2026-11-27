// PLT-25 (T-66): bundles service-worker/sw.ts to public/sw.js before `next dev` and `next build`.
// The build id names the caches, so a new deployment replaces the old caches on activation.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function buildId() {
  try {
    const sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
    return `${sha}-${Date.now().toString(36)}`;
  } catch {
    return Date.now().toString(36);
  }
}

mkdirSync(join(root, 'public'), { recursive: true });
await build({
  entryPoints: [join(root, 'service-worker', 'sw.ts')],
  outfile: join(root, 'public', 'sw.js'),
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  define: { __BUILD_ID__: JSON.stringify(buildId()) },
});
console.log('service worker built: public/sw.js');
