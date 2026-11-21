// Thin wrapper: the validator lives in cli/src/lib/validate.ts and ships in
// the bundled CLI, so there is only one validator to keep correct. This
// script builds the bundle when it is missing or stale, then runs
// `wekyt validate --project <hub root> [--generate]`.
// Usage: node scripts/validate-tools.mjs [--generate]
import * as fs from 'node:fs';
import * as path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(root, '..');
// WEKYT_HUB_DIR overrides the hub root, for tests on a copied tree.
const hubDir = process.env.WEKYT_HUB_DIR ? path.resolve(process.env.WEKYT_HUB_DIR) : path.resolve(cliDir, '..');
const bin = path.join(cliDir, 'dist', 'wekyt.js');

function srcNewerThanBin() {
  if (!fs.existsSync(bin)) return true;
  const binTime = fs.statSync(bin).mtimeMs;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (walk(p)) return true;
      } else if (fs.statSync(p).mtimeMs > binTime) {
        return true;
      }
    }
    return false;
  };
  return walk(path.join(cliDir, 'src'));
}

if (srcNewerThanBin()) {
  execFileSync(process.execPath, [path.join(cliDir, 'scripts', 'build.mjs')], {stdio: 'pipe'});
}

const args = ['validate', '--project', hubDir];
if (process.argv.includes('--generate')) args.push('--generate');
try {
  execFileSync(process.execPath, [bin, ...args], {stdio: 'inherit'});
} catch (e) {
  process.exit(typeof e.status === 'number' ? e.status : 1);
}
