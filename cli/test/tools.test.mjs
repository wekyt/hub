// Tools validation tests: the validator passes on the real definitions,
// and it catches a contradiction (readOnlyHint true with write effects)
// on a tampered copy of the tree.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);
const cliDir = path.resolve(import.meta.dirname, '..');
const hubDir = path.resolve(cliDir, '..');
const validator = path.join(cliDir, 'scripts', 'validate-tools.mjs');

test('validator passes on the real tool definitions', async () => {
  const {stdout} = await run(process.execPath, [validator], {timeout: 30000});
  assert.match(stdout, /validated 14 definitions, no errors/);
});

test('validator rejects readOnlyHint true with write effects', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-tools-'));
  try {
    fs.cpSync(path.join(hubDir, 'ai', 'tools'), path.join(tmp, 'ai', 'tools'), {recursive: true});
    fs.cpSync(path.join(hubDir, 'ai', 'agents'), path.join(tmp, 'ai', 'agents'), {recursive: true});
    const file = path.join(tmp, 'ai', 'tools', 'read_file.yaml');
    const original = fs.readFileSync(file, 'utf8');
    const tampered = original.replace('  writes: []', '  writes:\n    - /tmp/evil.txt');
    assert.notEqual(tampered, original);
    fs.writeFileSync(file, tampered);
    await assert.rejects(
      run(process.execPath, [validator], {timeout: 30000, env: {...process.env, WEKYT_HUB_DIR: tmp}}),
      /contradiction: readOnlyHint is true/,
    );
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});
