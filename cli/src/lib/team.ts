import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {VERSION, DEFAULT_CHANNEL, type Channel} from '../version';
import {WekytError, commandExists, compareSemver, ensureWekytHome, formatBytes} from './util';
import {loadConfig, saveConfig, saveState} from './config';
import {downloadToFile, extractAi, resolveRelease, verifyTarball, type ReleaseInfo} from './release';

export type StepState = 'pending' | 'running' | 'done' | 'failed';
export interface Step {
  label: string;
  state: StepState;
  detail?: string;
}
export type OnStep = (steps: Step[]) => void;

export function projectAiDir(projectDir: string): string {
  return path.join(projectDir, 'ai');
}

export function versionOfAiDir(aiDir: string): string | null {
  const versionFile = path.join(aiDir, 'VERSION');
  if (!fs.existsSync(versionFile)) return null;
  const v = fs.readFileSync(versionFile, 'utf8').trim();
  return v || null;
}

export function installedVersion(projectDir: string): string | null {
  const aiDir = projectAiDir(projectDir);
  if (!fs.existsSync(aiDir)) return null;
  return versionOfAiDir(aiDir) || 'unknown';
}

export function countAiFiles(projectDir: string): number {
  const aiDir = projectAiDir(projectDir);
  if (!fs.existsSync(aiDir)) return 0;
  let n = 0;
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, {withFileTypes: true})) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) n++;
    }
  };
  walk(aiDir);
  return n;
}

function stampVersion(aiDir: string, version: string): void {
  const versionFile = path.join(aiDir, 'VERSION');
  if (!fs.existsSync(versionFile)) {
    fs.writeFileSync(versionFile, `${version}\n`);
  }
}

function backupsDir(): string {
  const dir = path.join(ensureWekytHome(), 'backups');
  fs.mkdirSync(dir, {recursive: true});
  return dir;
}

export interface BackupMeta {
  version: string;
  tag: string;
  backedUpAt: string;
  path: string;
}

export function listBackups(): BackupMeta[] {
  const dir = backupsDir();
  const out: BackupMeta[] = [];
  for (const name of fs.readdirSync(dir)) {
    const metaPath = path.join(dir, name, 'meta.json');
    if (fs.existsSync(metaPath)) {
      try {
        out.push(JSON.parse(fs.readFileSync(metaPath, 'utf8')) as BackupMeta);
      } catch {
        // skip corrupt entry
      }
    }
  }
  out.sort((a, b) => (a.backedUpAt < b.backedUpAt ? 1 : -1));
  return out;
}

function saveBackup(projectDir: string): BackupMeta | null {
  const aiDir = projectAiDir(projectDir);
  if (!fs.existsSync(aiDir)) return null;
  const version = installedVersion(projectDir) || 'unknown';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(backupsDir(), `${version}-${stamp}`);
  fs.mkdirSync(dest, {recursive: true});
  fs.cpSync(aiDir, path.join(dest, 'ai'), {recursive: true});
  const meta: BackupMeta = {version, tag: `v${version}`, backedUpAt: new Date().toISOString(), path: dest};
  fs.writeFileSync(path.join(dest, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  const all = listBackups();
  for (const old of all.slice(5)) {
    fs.rmSync(old.path, {recursive: true, force: true});
  }
  return meta;
}

export interface DownloadResult {
  release: ReleaseInfo;
  tarballPath: string;
  workDir: string;
  aiDir: string;
  sha256: string;
  bytes: number;
}

/** Download, verify and extract a release. Nothing under the project changes. */
export async function fetchTeamPackage(release: ReleaseInfo, onStep?: OnStep): Promise<DownloadResult> {
  const steps: Step[] = [
    {label: `Download ${release.tag}`, state: 'running'},
    {label: 'Verify SHA-256', state: 'pending'},
    {label: 'Extract ai/', state: 'pending'},
  ];
  const report = () => onStep?.(steps.map((s) => ({...s})));
  report();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-dl-'));
  const tarballPath = path.join(tmpDir, 'wekyt-hub.tar.gz');
  try {
    if (release.localTarball) {
      fs.copyFileSync(release.localTarball, tarballPath);
    } else {
      await downloadToFile(release.tarballUrl, tarballPath);
    }
    const bytes = fs.statSync(tarballPath).size;
    steps[0].state = 'done';
    steps[0].detail = formatBytes(bytes);
    steps[1].state = 'running';
    report();
    const {sha256} = await verifyTarball(tarballPath, release);
    steps[1].state = 'done';
    steps[1].detail = sha256.slice(0, 12) + '...';
    steps[2].state = 'running';
    report();
    const {workDir, aiDir} = extractAi(tarballPath);
    steps[2].state = 'done';
    report();
    return {release, tarballPath, workDir, aiDir, sha256, bytes};
  } catch (e) {
    steps.forEach((s) => {
      if (s.state === 'running') s.state = 'failed';
    });
    report();
    fs.rmSync(tmpDir, {recursive: true, force: true});
    throw e;
  }
}

export interface InstallOptions {
  force?: boolean;
  tag?: string;
  onStep?: OnStep;
}

export async function installTeam(projectDir: string, opts: InstallOptions = {}): Promise<{version: string; files: number}> {
  const aiDir = projectAiDir(projectDir);
  if (fs.existsSync(aiDir) && !opts.force) {
    throw new WekytError(
      'AI_EXISTS',
      `ai/ already exists in ${projectDir}.`,
      'Move it aside first, or run with --force to replace it. Replacing ai/ also replaces CONTEXT.md and your skills, so keep them safe first.',
    );
  }
  const release = await resolveRelease(opts.tag);
  const pkg = await fetchTeamPackage(release, opts.onStep);
  try {
    if (opts.force && fs.existsSync(aiDir)) {
      fs.rmSync(aiDir, {recursive: true, force: true});
    }
    fs.renameSync(pkg.aiDir, aiDir);
    stampVersion(aiDir, release.version);
    // The version that counts is the one stamped inside ai/VERSION, which
    // the release process writes from the tag. A local tarball resolves as
    // version "local", so report the stamped version instead.
    const version = installedVersion(projectDir) || release.version;
    const files = countAiFiles(projectDir);
    saveState({lastAttempt: new Date().toISOString(), lastAttemptOk: true});
    return {version, files};
  } finally {
    fs.rmSync(pkg.workDir, {recursive: true, force: true});
    fs.rmSync(path.dirname(pkg.tarballPath), {recursive: true, force: true});
  }
}

export interface UpdateOptions {
  check?: boolean;
  channel?: Channel;
  rollback?: boolean;
  tag?: string;
  onStep?: OnStep;
}

export interface UpdateCheckResult {
  current: string | null;
  latest: string;
  channel: Channel;
  upToDate: boolean;
}

async function latestVersionForChannel(channel: Channel): Promise<{version: string; tag: string}> {
  if (channel === 'latest') {
    const release = await resolveRelease();
    return {version: release.version, tag: release.tag};
  }
  // stable: the npm dist-tag, if the release process published one.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch('https://registry.npmjs.org/wekyt', {signal: ctrl.signal});
    if (!res.ok) {
      throw new WekytError(
        'NO_STABLE_CHANNEL',
        'No stable channel is published yet (npm registry returned an error for wekyt).',
        'Use --channel latest, or wait until a stable tag is published. See cli/PUBLISHING.md.',
      );
    }
    const data = (await res.json()) as {['dist-tags']?: Record<string, string>};
    const stable = data['dist-tags']?.stable;
    if (!stable) {
      throw new WekytError(
        'NO_STABLE_CHANNEL',
        'No stable version is published yet: the npm dist-tag "stable" does not exist.',
        'Use --channel latest. A stable tag is published one week after a latest release with no major regressions.',
      );
    }
    return {version: stable, tag: `v${stable}`};
  } catch (e) {
    if (e instanceof WekytError) throw e;
    throw new WekytError('NO_STABLE_CHANNEL', `Could not read the stable channel: ${e instanceof Error ? e.message : String(e)}.`);
  } finally {
    clearTimeout(timer);
  }
}

export async function checkTeamUpdate(projectDir: string, channel: Channel): Promise<UpdateCheckResult> {
  const current = installedVersion(projectDir);
  const {version} = await latestVersionForChannel(channel);
  const upToDate = current !== null && current !== 'unknown' && compareSemver(current, version) >= 0;
  return {current, latest: version, channel, upToDate};
}

export async function updateTeam(projectDir: string, opts: UpdateOptions = {}): Promise<{version: string; files: number; rolledBack?: boolean}> {
  const channel: Channel = opts.channel || loadConfig().autoUpdatesChannel || DEFAULT_CHANNEL;
  if (opts.channel) saveConfig({autoUpdatesChannel: opts.channel});

  if (opts.rollback) {
    const backups = listBackups();
    if (backups.length === 0) {
      throw new WekytError('NO_BACKUP', 'No previous copy of ai/ is saved, so there is nothing to roll back to.');
    }
    const latest = backups[0];
    const aiDir = projectAiDir(projectDir);
    const displaced = saveBackup(projectDir);
    if (fs.existsSync(aiDir)) fs.rmSync(aiDir, {recursive: true, force: true});
    fs.cpSync(path.join(latest.path, 'ai'), aiDir, {recursive: true});
    const files = countAiFiles(projectDir);
    return {version: latest.version, files, rolledBack: true};
  }

  if (opts.check) {
    const result = await checkTeamUpdate(projectDir, channel);
    return {version: result.latest, files: countAiFiles(projectDir)};
  }

  const current = installedVersion(projectDir);
  if (current === null) {
    throw new WekytError('NO_TEAM', 'No ai/ folder in this project.', 'Run `wekyt install` first.');
  }
  let release: ReleaseInfo;
  if (opts.tag) {
    release = await resolveRelease(opts.tag);
  } else if (channel === 'stable') {
    const {tag} = await latestVersionForChannel('stable');
    release = await resolveRelease(tag);
  } else {
    release = await resolveRelease();
  }
  const pkg = await fetchTeamPackage(release, opts.onStep);
  // The version that counts is the one stamped inside the downloaded
  // ai/VERSION, not the tag alone: a local tarball resolves as "local".
  const newVersion = versionOfAiDir(pkg.aiDir) || release.version;
  if (current !== 'unknown' && compareSemver(current, newVersion) >= 0) {
    fs.rmSync(pkg.workDir, {recursive: true, force: true});
    fs.rmSync(path.dirname(pkg.tarballPath), {recursive: true, force: true});
    return {version: current, files: countAiFiles(projectDir)};
  }
  try {
    saveBackup(projectDir);
    const aiDir = projectAiDir(projectDir);
    fs.rmSync(aiDir, {recursive: true, force: true});
    fs.renameSync(pkg.aiDir, aiDir);
    stampVersion(aiDir, newVersion);
    const files = countAiFiles(projectDir);
    saveState({lastAttempt: new Date().toISOString(), lastAttemptOk: true});
    return {version: newVersion, files};
  } catch (e) {
    saveState({lastAttempt: new Date().toISOString(), lastAttemptOk: false, lastAttemptError: e instanceof Error ? e.message : String(e)});
    throw e;
  } finally {
    fs.rmSync(pkg.workDir, {recursive: true, force: true});
    fs.rmSync(path.dirname(pkg.tarballPath), {recursive: true, force: true});
  }
}

export function uninstallTeam(projectDir: string): boolean {
  const aiDir = projectAiDir(projectDir);
  if (!fs.existsSync(aiDir)) return false;
  fs.rmSync(aiDir, {recursive: true, force: true});
  return true;
}

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
  fix?: string;
  severity: 'fail' | 'warn';
}

export function doctor(projectDir: string): DoctorCheck[] {
  const checks: DoctorCheck[] = [];
  const nodeOk = compareSemver(process.versions.node, '22.12.0') >= 0;
  checks.push({
    name: 'Node.js >= 22.12.0',
    ok: nodeOk,
    detail: `Node ${process.versions.node}`,
    fix: nodeOk ? undefined : 'Install Node.js 22.12 or newer from https://nodejs.org, or use the curl installer which needs no Node.',
    severity: 'fail',
  });
  for (const tool of ['curl', 'tar']) {
    const ok = commandExists(tool);
    checks.push({
      name: `Tool: ${tool}`,
      ok,
      detail: ok ? 'found on PATH' : 'not found on PATH',
      fix: ok ? undefined : `Install ${tool} with your system package manager.`,
      severity: 'fail',
    });
  }
  const version = installedVersion(projectDir);
  checks.push({
    name: 'Team (./ai/)',
    ok: version !== null,
    detail: version === null ? 'no ai/ folder in this project' : `installed, version ${version}${version === 'unknown' ? ' (no ai/VERSION file, pre-0.2.0 install)' : ''}`,
    fix: version === null ? 'Run `wekyt install` in this project.' : undefined,
    severity: 'warn',
  });
  const state = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(ensureWekytHome(), 'update-state.json'), 'utf8')) as {
        lastCheck?: string;
        lastAttempt?: string;
        lastAttemptOk?: boolean;
        lastAttemptError?: string;
      };
    } catch {
      return {};
    }
  })();
  checks.push({
    name: 'Last update check',
    ok: true,
    detail: state.lastCheck ? `checked ${state.lastCheck}` : 'never checked',
    severity: 'warn',
  });
  checks.push({
    name: 'Last install/update attempt',
    ok: state.lastAttemptOk !== false,
    detail: state.lastAttempt
      ? `${state.lastAttemptOk ? 'ok' : 'failed'} at ${state.lastAttempt}${state.lastAttemptError ? ': ' + state.lastAttemptError : ''}`
      : 'none recorded',
    severity: 'warn',
  });
  const cfg = loadConfig();
  checks.push({
    name: 'Auto-updates',
    ok: true,
    detail: process.env.WEKYT_NO_AUTO_UPDATE === '1' ? 'disabled (WEKYT_NO_AUTO_UPDATE=1)' : `enabled, channel ${cfg.autoUpdatesChannel}`,
    severity: 'warn',
  });
  return checks;
}

export function statusLines(projectDir: string): string[] {
  const cfg = loadConfig();
  const version = installedVersion(projectDir);
  return [
    `wekyt ${VERSION}`,
    `install method: ${detectInstallMethod()}`,
    `channel: ${cfg.autoUpdatesChannel}`,
    version === null ? 'team: no ai/ folder in this project' : `team: ai/ installed, version ${version}, ${countAiFiles(projectDir)} files`,
    `node: ${process.versions.node}`,
  ];
}

export function detectInstallMethod(): string {
  if (process.env.WEKYT_INSTALL_METHOD) return process.env.WEKYT_INSTALL_METHOD;
  const here = fileURLToPath(import.meta.url);
  if (here.includes(`${path.sep}.pnpm${path.sep}`)) return 'pnpm';
  if (here.includes(`${path.sep}node_modules${path.sep}wekyt${path.sep}`) || here.includes(`${path.sep}lib${path.sep}node_modules${path.sep}wekyt`)) {
    return 'npm';
  }
  if (here.includes('node_modules')) return 'npm';
  return 'local';
}

export function selfUpdateCli(channel: Channel): void {
  const spec = channel === 'stable' ? 'wekyt@stable' : 'wekyt@latest';
  if (detectInstallMethod() === 'pnpm') {
    if (!commandExists('pnpm')) {
      throw new WekytError('NO_PNPM', 'pnpm is not on PATH, so the CLI cannot update itself.', 'Install pnpm (https://pnpm.io/installation) or reinstall the CLI with npm.');
    }
    try {
      execFileSync('pnpm', ['add', '-g', spec], {stdio: 'inherit'});
    } catch {
      throw new WekytError(
        'SELF_UPDATE_FAILED',
        `pnpm add -g ${spec} failed.`,
        'Check that the global pnpm directory is writable without sudo, and that the wekyt package is published. See cli/PUBLISHING.md.',
      );
    }
    return;
  }
  if (!commandExists('npm')) {
    throw new WekytError('NO_NPM', 'npm is not on PATH, so the CLI cannot update itself.', 'Install Node.js 22.12 or newer, which includes npm.');
  }
  try {
    execFileSync('npm', ['install', '-g', spec], {stdio: 'inherit'});
  } catch {
    throw new WekytError(
      'SELF_UPDATE_FAILED',
      `npm install -g ${spec} failed.`,
      'Check that the global npm directory is writable without sudo, and that the wekyt package is published. See cli/PUBLISHING.md.',
    );
  }
}
