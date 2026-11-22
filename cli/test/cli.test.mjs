// CLI integration tests: the bundled binary in temp project dirs, with a
// local tarball and checksums, so no network or GitHub release is needed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFile, execFileSync} from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {promisify} from 'node:util';

const run = promisify(execFile);
const cliDir = path.resolve(import.meta.dirname, '..');
const hubDir = path.resolve(cliDir, '..');
const bin = path.join(cliDir, 'dist', 'wekyt.js');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function makePackage(aiSource, outDir, version) {
  const aiCopy = path.join(outDir, 'ai-copy');
  fs.cpSync(aiSource, aiCopy, {recursive: true});
  fs.writeFileSync(path.join(aiCopy, 'VERSION'), `${version}\n`);
  const tarball = path.join(outDir, 'wekyt-hub.tar.gz');
  const stage = path.join(outDir, 'stage');
  fs.mkdirSync(stage);
  fs.cpSync(aiCopy, path.join(stage, 'ai'), {recursive: true});
  execFileSync('tar', ['-czf', tarball, '-C', stage, 'ai'], {stdio: 'pipe'});
  const sums = path.join(outDir, 'SHA256SUMS');
  fs.writeFileSync(sums, `${sha256(tarball)}  wekyt-hub.tar.gz\n`);
  return {tarball, sums};
}

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-cli-'));
  const home = path.join(tmp, 'home');
  const project = path.join(tmp, 'project');
  fs.mkdirSync(home);
  fs.mkdirSync(project);
  const pkg = makePackage(path.join(hubDir, 'ai'), path.join(tmp, 'pkg'), '0.2.0');
  const env = {
    ...process.env,
    HOME: home,
    // os.homedir() reads USERPROFILE on Windows, HOME everywhere else.
    USERPROFILE: home,
    WEKYT_NO_AUTO_UPDATE: '1',
    WEKYT_TARBALL: pkg.tarball,
    WEKYT_SHA256SUMS: pkg.sums,
  };
  return {tmp, home, project, pkg, env};
}

/** A fake binary on PATH. On Windows it must be a .cmd file to execute. */
function makeStubBin(dir, name, posixBody, winBody) {
  const file = process.platform === 'win32' ? path.join(dir, `${name}.cmd`) : path.join(dir, name);
  const content = process.platform === 'win32' ? `${winBody}\r\n` : `#!/bin/sh\n${posixBody}\n`;
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
  return file;
}

/** A stub that records its arguments in a file, for update --self. */
function makeArgRecorder(dir, name, recordPath) {
  return makeStubBin(dir, name, `echo "$@" >> ${recordPath}`, `@echo %* >> ${recordPath}`);
}

/** A stub that answers --version, for harness detection. */
function makeVersionStub(dir, name, version) {
  return makeStubBin(dir, name, `echo "${name} ${version}"`, `@echo ${name} ${version}`);
}

async function wekyt(args, cwd, env) {
  try {
    const {stdout, stderr} = await run(process.execPath, [bin, ...args], {cwd, env, timeout: 60000});
    return {code: 0, stdout, stderr};
  } catch (e) {
    return {code: e.code, stdout: e.stdout || '', stderr: e.stderr || ''};
  }
}

test('wekyt --version shows version, method and channel', async () => {
  const {project, env} = setup();
  const r = await wekyt(['--version'], project, env);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /wekyt \d+\.\d+\.\d+ \(.+,.+channel latest\)/);
});

test('wekyt --version reports pnpm install method', async () => {
  const {project, env} = setup();
  const r = await wekyt(['--version'], project, {...env, WEKYT_INSTALL_METHOD: 'pnpm'});
  assert.equal(r.code, 0);
  assert.match(r.stdout, /wekyt \d+\.\d+\.\d+ \(pnpm, channel latest\)/);
});

test('update --self uses pnpm add -g when installed with pnpm', async () => {
  const {project, env} = setup();
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-pnpm-stub-'));
  const calls = path.join(stubDir, 'calls.txt');
  makeArgRecorder(stubDir, 'pnpm', calls);
  const r = await wekyt(['update', '--self'], project, {
    ...env,
    WEKYT_INSTALL_METHOD: 'pnpm',
    PATH: `${stubDir}${path.delimiter}${process.env.PATH}`,
  });
  assert.equal(r.code, 0);
  assert.equal(fs.readFileSync(calls, 'utf8').trim(), 'add -g wekyt@latest');
});

test('wekyt doctor passes in an empty project', async () => {
  const {project, env} = setup();
  const r = await wekyt(['doctor'], project, env);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /ok Node\.js >= 22\.12\.0/);
  assert.match(r.stdout, /team: no ai\/ folder in this project/);
});

test('install, reinstall refusal, force reinstall, uninstall', async () => {
  const {project, env} = setup();
  const installed = await wekyt(['install'], project, env);
  assert.equal(installed.code, 0, installed.stderr);
  assert.match(installed.stdout, /Team 0\.2\.0/);
  assert.equal(fs.readFileSync(path.join(project, 'ai', 'VERSION'), 'utf8').trim(), '0.2.0');
  assert.ok(fs.existsSync(path.join(project, 'ai', 'tools', 'read_file.yaml')));

  const again = await wekyt(['install'], project, env);
  assert.notEqual(again.code, 0);
  assert.match(again.stderr, /ai\/ already exists/);
  assert.ok(fs.existsSync(path.join(project, 'ai', 'VERSION')));

  const forced = await wekyt(['install', '--force'], project, env);
  assert.equal(forced.code, 0, forced.stderr);

  const doctor = await wekyt(['doctor'], project, env);
  assert.match(doctor.stdout, /team: ai\/ installed, version 0\.2\.0/);

  const removed = await wekyt(['uninstall', '--yes'], project, env);
  assert.equal(removed.code, 0, removed.stderr);
  assert.ok(!fs.existsSync(path.join(project, 'ai')));
});

test('install refuses a tarball with a bad checksum and installs nothing', async () => {
  const {tmp, project, pkg, env} = setup();
  const bad = path.join(tmp, 'bad.tar.gz');
  fs.copyFileSync(pkg.tarball, bad);
  fs.appendFileSync(bad, 'corruption');
  const r = await wekyt(['install'], project, {...env, WEKYT_TARBALL: bad});
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /SHA-256 mismatch/);
  assert.ok(!fs.existsSync(path.join(project, 'ai')));
});

test('install refuses a tarball with no checksums file', async () => {
  const {tmp, project, pkg, env} = setup();
  // Move the tarball away from its sibling SHA256SUMS file, so no
  // checksums source remains: no WEKYT_SHA256SUMS and no sibling file.
  const isolated = path.join(tmp, 'isolated.tar.gz');
  fs.copyFileSync(pkg.tarball, isolated);
  const noSums = {...env, WEKYT_TARBALL: isolated};
  delete noSums.WEKYT_SHA256SUMS;
  const r = await wekyt(['install'], project, noSums);
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /no SHA256SUMS file/);
  assert.ok(!fs.existsSync(path.join(project, 'ai')));
});

test('update to a newer local release and rollback restores the old team', async () => {
  const {tmp, project, env} = setup();
  const installed = await wekyt(['install'], project, env);
  assert.equal(installed.code, 0, installed.stderr);

  const next = makePackage(path.join(hubDir, 'ai'), path.join(tmp, 'pkg-next'), '9.9.9');
  const nextEnv = {...env, WEKYT_TARBALL: next.tarball, WEKYT_SHA256SUMS: next.sums};
  const updated = await wekyt(['update', '--tag', 'v9.9.9'], project, nextEnv);
  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /0\.2\.0 -> 9\.9\.9/);
  assert.equal(fs.readFileSync(path.join(project, 'ai', 'VERSION'), 'utf8').trim(), '9.9.9');

  const rolled = await wekyt(['update', '--rollback'], project, env);
  assert.equal(rolled.code, 0, rolled.stderr);
  assert.match(rolled.stdout, /Restored team 0\.2\.0/);
  assert.equal(fs.readFileSync(path.join(project, 'ai', 'VERSION'), 'utf8').trim(), '0.2.0');
});

test('manifest round-trips after install', async () => {
  const {project, env} = setup();
  const installed = await wekyt(['install'], project, env);
  assert.equal(installed.code, 0, installed.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(project, 'ai', '.wekyt-manifest.json'), 'utf8'));
  assert.equal(manifest.version, '0.2.0');
  assert.equal(typeof manifest.installedAt, 'string');
  assert.equal(manifest.files['agents/dev.md'], sha256(path.join(project, 'ai', 'agents', 'dev.md')));
  assert.equal(manifest.files['VERSION'], sha256(path.join(project, 'ai', 'VERSION')));
  assert.ok(!('skills/mi-skill.md' in manifest.files));
});

test('custom skill survives update and install --force, modified team file gets .bak', async () => {
  const {tmp, project, env} = setup();
  const installed = await wekyt(['install'], project, env);
  assert.equal(installed.code, 0, installed.stderr);
  fs.writeFileSync(
    path.join(project, 'ai', 'skills', 'mi-skill.md'),
    '---\nname: mi-skill\ndescription: A custom skill for testing.\n---\n\nDo the thing.\n',
  );
  fs.appendFileSync(path.join(project, 'ai', 'agents', 'dev.md'), '\nUSER EDIT\n');

  const next = makePackage(path.join(hubDir, 'ai'), path.join(tmp, 'pkg-next'), '9.9.9');
  const nextEnv = {...env, WEKYT_TARBALL: next.tarball, WEKYT_SHA256SUMS: next.sums};
  const updated = await wekyt(['update', '--tag', 'v9.9.9'], project, nextEnv);
  assert.equal(updated.code, 0, updated.stderr);
  assert.match(updated.stdout, /kept 1 of your own file/);
  assert.match(updated.stdout, /saved as \.bak/);
  assert.equal(fs.readFileSync(path.join(project, 'ai', 'skills', 'mi-skill.md'), 'utf8').includes('mi-skill'), true);
  assert.equal(fs.readFileSync(path.join(project, 'ai', 'agents', 'dev.md.bak'), 'utf8').includes('USER EDIT'), true);
  assert.equal(fs.readFileSync(path.join(project, 'ai', 'agents', 'dev.md'), 'utf8').includes('USER EDIT'), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'ai', '.wekyt-manifest.json'), 'utf8')).version, '9.9.9');
  // The manifest lists only release files: the preserved skill and the
  // .bak copy must not be absorbed into the tracked set, or the next
  // install would drop them as unmodified.
  const afterUpdate = JSON.parse(fs.readFileSync(path.join(project, 'ai', '.wekyt-manifest.json'), 'utf8'));
  assert.ok(!('skills/mi-skill.md' in afterUpdate.files));
  assert.ok(!('agents/dev.md.bak' in afterUpdate.files));

  const forced = await wekyt(['install', '--force'], project, env);
  assert.equal(forced.code, 0, forced.stderr);
  assert.match(forced.stdout, /kept 2 of your own file/);
  assert.equal(fs.existsSync(path.join(project, 'ai', 'skills', 'mi-skill.md')), true);
  assert.equal(fs.existsSync(path.join(project, 'ai', 'agents', 'dev.md.bak')), true);
  assert.equal(fs.readFileSync(path.join(project, 'ai', 'VERSION'), 'utf8').trim(), '0.2.0');
});

test('install, update and doctor work with no tar binary on PATH', async () => {
  const {project, env} = setup();
  const emptyBin = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-emptybin-'));
  const noBinEnv = {...env, PATH: emptyBin};
  const installed = await wekyt(['install'], project, noBinEnv);
  assert.equal(installed.code, 0, installed.stderr);
  const doctor = await wekyt(['doctor'], project, noBinEnv);
  assert.equal(doctor.code, 0, doctor.stderr);
  assert.match(doctor.stdout, /ok Validate \.\/ai\//);
  assert.doesNotMatch(doctor.stdout, /Tool: (curl|tar)/);
});

test('validate passes on a good team and fails on a broken tools YAML', async () => {
  const {project, env} = setup();
  const installed = await wekyt(['install'], project, env);
  assert.equal(installed.code, 0, installed.stderr);
  const ok = await wekyt(['validate'], project, env);
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stdout, /wekyt validate: ok \(18 tools, 0 skills, 0 errors\)/);

  const file = path.join(project, 'ai', 'tools', 'read_file.yaml');
  const original = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, original.replace('title: Read file', 'title: ""'));
  const bad = await wekyt(['validate'], project, env);
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /read_file\.yaml/);
  assert.match(bad.stderr, /title is required/);

  const json = await wekyt(['validate', '--json'], project, env);
  assert.notEqual(json.code, 0);
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.ok, false);
  assert.ok(parsed.errors.some((e) => e.includes('read_file.yaml')));
});

test('init is idempotent and never overwrites an existing bridge file', async () => {
  const {project, env} = setup();
  const installed = await wekyt(['install'], project, env);
  assert.equal(installed.code, 0, installed.stderr);
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-claude-stub-'));
  makeVersionStub(stubDir, 'claude', '1.0.0');
  const stubEnv = {...env, PATH: `${stubDir}${path.delimiter}${process.env.PATH}`};

  const first = await wekyt(['init', '--harness', 'claude'], project, stubEnv);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /bridge file created at .*CLAUDE\.md/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(project, 'ai', 'wekyt.config.json'), 'utf8')).harness, 'claude');
  assert.match(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), /ai\/CONTEXT\.md/);

  fs.appendFileSync(path.join(project, 'CLAUDE.md'), '\nMY BRIDGE EDIT\n');
  const again = await wekyt(['init', '--harness', 'claude'], project, stubEnv);
  assert.notEqual(again.code, 0);
  assert.match(again.stderr, /already exists/);

  const forced = await wekyt(['init', '--harness', 'claude', '--force'], project, stubEnv);
  assert.equal(forced.code, 0, forced.stderr);
  assert.match(forced.stdout, /already exists and was not modified/);
  assert.match(forced.stdout, /ai\/CONTEXT\.md/);
  assert.match(fs.readFileSync(path.join(project, 'CLAUDE.md'), 'utf8'), /MY BRIDGE EDIT/);
});

test('init rejects an unknown harness and cursor init writes the rules file', async () => {
  const {project, env} = setup();
  const installed = await wekyt(['install'], project, env);
  assert.equal(installed.code, 0, installed.stderr);
  const bad = await wekyt(['init', '--harness', 'not-a-harness'], project, env);
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /unknown harness/);

  fs.mkdirSync(path.join(project, '.cursor'));
  const cursor = await wekyt(['init', '--harness', 'cursor'], project, env);
  assert.equal(cursor.code, 0, cursor.stderr);
  const bridge = path.join(project, '.cursor', 'rules', 'wekyt.mdc');
  assert.ok(fs.existsSync(bridge));
  assert.match(fs.readFileSync(bridge, 'utf8'), /alwaysApply: true/);
});

test('doctor --json reports validation and the configured harness', async () => {
  const {project, env} = setup();
  const installed = await wekyt(['install'], project, env);
  assert.equal(installed.code, 0, installed.stderr);
  const stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-gemini-stub-'));
  makeVersionStub(stubDir, 'gemini', '0.5.0');
  const stubEnv = {...env, PATH: `${stubDir}${path.delimiter}${process.env.PATH}`};
  const inited = await wekyt(['init', '--harness', 'gemini'], project, stubEnv);
  assert.equal(inited.code, 0, inited.stderr);

  const r = await wekyt(['doctor', '--json'], project, stubEnv);
  assert.equal(r.code, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.ok, true);
  const names = parsed.checks.map((c) => c.name);
  assert.ok(names.includes('Validate ./ai/'));
  assert.ok(names.includes('Harness (gemini)'));
  assert.ok(parsed.checks.find((c) => c.name === 'Harness (gemini)').ok);
  assert.doesNotMatch(r.stdout, /Tool: (curl|tar)/);
});
