// TUI tests: bundle test/tui-entry.tsx with esbuild (same bundler as the
// CLI) and run it against the real App in a temp project dir.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);
const cliDir = path.resolve(import.meta.dirname, '..');

async function buildEntry() {
  const out = path.join(os.tmpdir(), `wekyt-tui-entry-${process.pid}.mjs`);
  // Build through the esbuild JS API, like scripts/build.mjs does for the
  // CLI. Spawning the esbuild binary breaks on Windows: the .cmd shim
  // needs a shell, and cmd.exe then splits the command line at the
  // semicolon inside the --banner:js argument.
  await esbuild.build({
    entryPoints: [path.join(cliDir, 'test', 'tui-entry.tsx')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    jsx: 'automatic',
    outfile: out,
    alias: {'signal-exit': path.join(cliDir, 'src', 'lib', 'signal-exit-shim.mjs')},
    banner: {
      js: 'import {createRequire} from "node:module";\nconst require = createRequire(import.meta.url);',
    },
    logLevel: 'error',
  });
  return out;
}

test('TUI menu, navigation, status screen and back', async () => {
  const entry = await buildEntry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-tui-'));
  try {
    const {stdout} = await run(process.execPath, [entry, dir, 'menu-status'], {timeout: 30000});
    assert.match(stdout, /menu renders: ok/);
    assert.match(stdout, /arrow down moves selection: ok/);
    assert.match(stdout, /status screen: ok/);
    assert.match(stdout, /back to menu: ok/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.rmSync(entry, {force: true});
  }
});

test('TUI init with no harness detected reports it', async () => {
  const entry = await buildEntry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-tui-'));
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-emptybin-'));
  try {
    // Empty PATH so no harness binary is found (codex is on PATH in this VM).
    const {stdout} = await run(process.execPath, [entry, dir, 'init-none'], {
      timeout: 30000,
      env: {...process.env, PATH: emptyBin},
    });
    assert.match(stdout, /init menu item: ok/);
    assert.match(stdout, /init with no harness detected: ok/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.rmSync(entry, {force: true});
  }
});

test('TUI install with existing ai/ asks for confirmation', async () => {
  const entry = await buildEntry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-tui-'));
  fs.mkdirSync(path.join(dir, 'ai'));
  try {
    const {stdout} = await run(process.execPath, [entry, dir, 'confirm'], {timeout: 30000});
    assert.match(stdout, /replace confirm: ok/);
    assert.match(stdout, /confirm no returns to menu: ok/);
  } finally {
    fs.rmSync(dir, {recursive: true, force: true});
    fs.rmSync(entry, {force: true});
  }
});
