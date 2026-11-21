// Unit tests for the spawn helpers in src/lib/util.ts. Node 24 runs the
// TypeScript source directly (type stripping), and the win32 branches are
// tested with an explicit platform argument, so they run on Linux too.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {shellOptionFor} from '../src/lib/util.ts';

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
