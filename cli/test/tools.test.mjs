// Tools validation tests: `wekyt validate` passes on the real definitions,
// catches a contradiction on a tampered copy, and regenerates the registry.
// The dev wrapper script delegates to the same validator in the bundle.
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
const bin = path.join(cliDir, 'dist', 'wekyt.js');
const wrapper = path.join(cliDir, 'scripts', 'validate-tools.mjs');

test('validate passes on the real tool definitions', async () => {
  const {stdout} = await run(process.execPath, [bin, 'validate', '--project', hubDir], {
    timeout: 30000,
    env: {...process.env, WEKYT_NO_AUTO_UPDATE: '1'},
  });
  assert.match(stdout, /wekyt validate: ok \(14 tools, 0 skills, 0 errors\)/);
});

test('validate passes when agent and skill files use CRLF line endings', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-crlf-'));
  try {
    fs.cpSync(path.join(hubDir, 'ai', 'tools'), path.join(tmp, 'ai', 'tools'), {recursive: true});
    fs.cpSync(path.join(hubDir, 'ai', 'agents'), path.join(tmp, 'ai', 'agents'), {recursive: true});
    fs.writeFileSync(path.join(tmp, 'ai', 'VERSION'), '0.3.0\n');
    // Windows checkouts use CRLF: the frontmatter parsers must see the
    // same line endings on every platform, or validate fails with
    // "cannot read frontmatter" and permissions mismatches.
    const toCrlf = (file) => {
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    };
    for (const f of fs.readdirSync(path.join(tmp, 'ai', 'agents'))) toCrlf(path.join(tmp, 'ai', 'agents', f));
    for (const f of fs.readdirSync(path.join(tmp, 'ai', 'tools')).filter((f) => f.endsWith('.yaml'))) {
      toCrlf(path.join(tmp, 'ai', 'tools', f));
    }
    fs.mkdirSync(path.join(tmp, 'ai', 'skills'), {recursive: true});
    fs.writeFileSync(
      path.join(tmp, 'ai', 'skills', 'mi-skill.md'),
      '---\r\nname: mi-skill\r\ndescription: A custom skill for testing.\r\n---\r\n\r\nDo the thing.\r\n',
    );
    const {stdout} = await run(process.execPath, [bin, 'validate', '--project', tmp], {
      timeout: 30000,
      env: {...process.env, WEKYT_NO_AUTO_UPDATE: '1'},
    });
    assert.match(stdout, /wekyt validate: ok \(14 tools, 1 skills, 0 errors\)/);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test('validate rejects readOnlyHint true with write effects', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-tools-'));
  try {
    fs.cpSync(path.join(hubDir, 'ai', 'tools'), path.join(tmp, 'ai', 'tools'), {recursive: true});
    fs.cpSync(path.join(hubDir, 'ai', 'agents'), path.join(tmp, 'ai', 'agents'), {recursive: true});
    fs.writeFileSync(path.join(tmp, 'ai', 'VERSION'), '0.3.0\n');
    const file = path.join(tmp, 'ai', 'tools', 'read_file.yaml');
    const original = fs.readFileSync(file, 'utf8');
    const tampered = original.replace('  writes: []', '  writes:\n    - /tmp/evil.txt');
    assert.notEqual(tampered, original);
    fs.writeFileSync(file, tampered);
    await assert.rejects(
      run(process.execPath, [bin, 'validate', '--project', tmp], {
        timeout: 30000,
        env: {...process.env, WEKYT_NO_AUTO_UPDATE: '1'},
      }),
      /contradiction: readOnlyHint is true/,
    );
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test('validate --generate regenerates tools.json and the permissions matrix', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-tools-'));
  try {
    fs.cpSync(path.join(hubDir, 'ai', 'tools'), path.join(tmp, 'ai', 'tools'), {recursive: true});
    fs.cpSync(path.join(hubDir, 'ai', 'agents'), path.join(tmp, 'ai', 'agents'), {recursive: true});
    fs.writeFileSync(path.join(tmp, 'ai', 'VERSION'), '0.3.0\n');
    fs.rmSync(path.join(tmp, 'ai', 'tools', 'tools.json'));
    const {stdout} = await run(process.execPath, [bin, 'validate', '--project', tmp, '--generate'], {
      timeout: 30000,
      env: {...process.env, WEKYT_NO_AUTO_UPDATE: '1'},
    });
    assert.match(stdout, /regenerated tools\.json and permissions\.md from 14 tool definitions/);
    const registry = JSON.parse(fs.readFileSync(path.join(tmp, 'ai', 'tools', 'tools.json'), 'utf8'));
    assert.equal(registry.tools.length, 14);
    const matrix = fs.readFileSync(path.join(tmp, 'ai', 'tools', 'permissions.md'), 'utf8');
    assert.match(matrix, /\| read_file \|/);
    assert.match(matrix, /## Hard rules/);
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
});

test('dev wrapper script delegates to the bundled validator', async () => {
  const {stdout} = await run(process.execPath, [wrapper], {timeout: 60000});
  assert.match(stdout, /wekyt validate: ok \(14 tools, 0 skills, 0 errors\)/);
});
