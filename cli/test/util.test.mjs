// Unit tests for the spawn helpers in src/lib/util.ts. Node 24 runs the
// TypeScript source directly (type stripping), and the win32 branches are
// tested with an explicit platform argument, so they run on Linux too.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {commandSuffixes, resolveCommand, shellOptionFor} from '../src/lib/util.ts';

test('commandSuffixes tries the bare name last on win32', () => {
  // Regression test for the 0.4.0 publish failure (workflow run #11):
  // the Windows Node distribution ships an extensionless `npm` shell
  // script next to npm.cmd, and resolving the bare name first returned a
  // file Windows cannot run (spawnSync ...\npm ENOENT).
  assert.deepEqual(commandSuffixes('win32'), ['.exe', '.bat', '.cmd', '']);
  assert.deepEqual(commandSuffixes('linux'), ['', '.exe', '.cmd']);
  assert.deepEqual(commandSuffixes('darwin'), ['', '.exe', '.cmd']);
});

test('resolveCommand prefers executable suffixes over a bare file on win32', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-util-'));
  fs.writeFileSync(path.join(dir, 'npm'), '#!/bin/sh\necho should-not-run\n');
  fs.writeFileSync(path.join(dir, 'npm.cmd'), '#!/bin/sh\necho hello-from-shim\n');
  const saved = process.env.PATH;
  try {
    // The win32 branch splits PATH on ';', so the fixture dir must be
    // joined with ';' for that call; a ':'-joined PATH is one entry to it.
    process.env.PATH = `${dir};${saved}`;
    const win32 = resolveCommand('npm', 'win32');
    assert.ok(win32.endsWith('.cmd'), `win32 must resolve to the shim: ${win32}`);
    assert.ok(fs.statSync(win32).isFile(), 'resolved path must be an existing file');
    assert.equal(resolveCommand('no-such-command-wekyt-xyz', 'win32'), null);
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    assert.equal(resolveCommand('npm', 'linux'), path.join(dir, 'npm'));
  } finally {
    process.env.PATH = saved;
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('shellOptionFor requires a shell for .cmd/.bat files on win32', () => {
  assert.deepEqual(shellOptionFor('C:\\tools\\pnpm.cmd', 'win32'), {shell: true});
  assert.deepEqual(shellOptionFor('C:\\tools\\tool.BAT', 'win32'), {shell: true});
  assert.deepEqual(shellOptionFor('C:\\tools\\tool.exe', 'win32'), {});
  assert.deepEqual(shellOptionFor('C:\\tools\\tool', 'win32'), {});
});

test('shellOptionFor never requires a shell off win32', () => {
  assert.deepEqual(shellOptionFor('/usr/bin/pnpm.cmd', 'linux'), {});
  assert.deepEqual(shellOptionFor('/usr/bin/pnpm', 'linux'), {});
  assert.deepEqual(shellOptionFor('/usr/bin/pnpm.cmd', 'darwin'), {});
});
