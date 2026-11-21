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
    WEKYT_NO_AUTO_UPDATE: '1',
    WEKYT_TARBALL: pkg.tarball,
    WEKYT_SHA256SUMS: pkg.sums,
  };
  return {tmp, home, project, pkg, env};
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
  const stub = path.join(stubDir, 'pnpm');
  fs.writeFileSync(stub, `#!/bin/sh\necho "$@" >> ${calls}\n`);
  fs.chmodSync(stub, 0o755);
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
