// Bundle the CLI and the TUI into a single file with esbuild.
// Usage: node scripts/build.mjs [--watch]
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(root, '..');
const outfile = path.join(cliDir, 'dist', 'wekyt.js');

const options = {
  entryPoints: [path.join(cliDir, 'src', 'cli.tsx')],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  outfile,
  jsx: 'automatic',
  // ESM output has no `require`, but several CJS dependencies bundled here
  // (stack-utils, react-devtools-core) call require('module') at runtime
  // through esbuild's shim, which throws without a real require in scope.
  // Provide one via createRequire, as bundlers of Ink CLIs do.
  banner: {
    js: '#!/usr/bin/env node\nimport {createRequire} from "node:module";\nconst require = createRequire(import.meta.url);',
  },
  logLevel: 'info',
  // Ink 8 is ESM with top-level await, so the bundle must be ESM. esbuild
  // cannot bundle signal-exit's CJS entry into ESM output (its
  // require('assert') survives as a runtime require), so it is aliased to
  // a minimal shim that implements the one call Ink makes. See
  // src/lib/signal-exit-shim.mjs.
  alias: {'signal-exit': path.join(cliDir, 'src', 'lib', 'signal-exit-shim.mjs')},
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching cli/src...');
} else {
  await esbuild.build(options);
  fs.chmodSync(outfile, 0o755);
  const size = fs.statSync(outfile).size;
  console.log(`built ${outfile} (${(size / 1024).toFixed(0)} KB)`);
}
