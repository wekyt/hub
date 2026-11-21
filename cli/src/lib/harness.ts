// Harness detection and configuration. wekyt never runs agents itself: init
// only writes ./ai/wekyt.config.json and the small bridge file the chosen
// harness reads to find the team. A bridge file that already exists is never
// modified; the user gets the exact snippet to add instead.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';
import {WekytError, commandExists, resolveCommand, shellOptionFor} from './util';

export const HARNESSES = ['claude', 'cursor', 'codex', 'gemini'] as const;
export type Harness = (typeof HARNESSES)[number];

export const CONFIG_NAME = 'wekyt.config.json';
export const CONFIG_VERSION = 1;

export interface ProjectConfig {
  harness: Harness;
  configVersion: number;
}

export interface HarnessInfo {
  id: Harness;
  label: string;
  /** Bridge file path, relative to the project root. */
  bridgePath: string;
  /** Binary on PATH for CLI harnesses, undefined for directory harnesses. */
  binary?: string;
}

export function harnessInfo(id: Harness): HarnessInfo {
  switch (id) {
    case 'claude':
      return {id, label: 'Claude Code (claude)', bridgePath: 'CLAUDE.md', binary: 'claude'};
    case 'cursor':
      return {id, label: 'Cursor (.cursor/rules/)', bridgePath: path.join('.cursor', 'rules', 'wekyt.mdc')};
    case 'codex':
      return {id, label: 'Codex (codex)', bridgePath: 'AGENTS.md', binary: 'codex'};
    case 'gemini':
      return {id, label: 'Gemini CLI (gemini)', bridgePath: 'GEMINI.md', binary: 'gemini'};
  }
}

export function isHarness(value: string): value is Harness {
  return (HARNESSES as readonly string[]).includes(value);
}

export function configFilePath(projectDir: string): string {
  return path.join(projectDir, 'ai', CONFIG_NAME);
}

export function readProjectConfig(projectDir: string): ProjectConfig | null {
  const p = configFilePath(projectDir);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as ProjectConfig;
    if (!isHarness(data.harness)) return null;
    return data;
  } catch {
    return null;
  }
}

function binaryResponds(binary: string): boolean {
  // Spawn the resolved path: a bare name fails on Windows when only a
  // .cmd shim is on PATH (CreateProcess appends .exe only), and a .cmd
  // shim needs the shell or Node refuses to spawn it (EINVAL).
  const resolved = resolveCommand(binary);
  if (!resolved) return false;
  try {
    const r = spawnSync(resolved, ['--version'], {timeout: 5000, stdio: 'pipe', ...shellOptionFor(resolved)});
    return r.status === 0;
  } catch {
    return false;
  }
}

export interface DetectedHarness {
  id: Harness;
  available: boolean;
  detail: string;
}

/** Detect which harnesses this machine can actually use right now. */
export function detectHarnesses(projectDir: string): DetectedHarness[] {
  return HARNESSES.map((id) => {
    const info = harnessInfo(id);
    if (id === 'cursor') {
      const found = fs.existsSync(path.join(projectDir, '.cursor'));
      return {id, available: found, detail: found ? '.cursor/ folder found' : 'no .cursor/ folder in this project'};
    }
    const binary = info.binary as string;
    if (!commandExists(binary)) {
      return {id, available: false, detail: `${binary} not found on PATH`};
    }
    const ok = binaryResponds(binary);
    return {id, available: ok, detail: ok ? `${binary} --version answered` : `${binary} found but --version failed`};
  });
}

const BRIDGE_BODY = `# wekyt team

This project uses the wekyt agent team in ./ai/.
Read ai/CONTEXT.md for the team map and ai/README.md for the rules,
then follow the orchestrator flow: brief, plan, architecture, build, QA.
`;

function bridgeContent(id: Harness): string {
  if (id === 'cursor') {
    return `---
description: wekyt agent team
globs:
alwaysApply: true
---

${BRIDGE_BODY}`;
  }
  return BRIDGE_BODY;
}

/** The snippet to add when the bridge file already exists and must not be touched. */
export function bridgeSnippet(id: Harness): string {
  return BRIDGE_BODY.trimEnd();
}

export interface InitResult {
  harness: Harness;
  configPath: string;
  bridgePath: string;
  bridgeCreated: boolean;
  snippet: string;
}

export function initHarness(projectDir: string, harness: Harness, opts: {force?: boolean} = {}): InitResult {
  const aiDir = path.join(projectDir, 'ai');
  if (!fs.existsSync(aiDir)) {
    throw new WekytError('NO_TEAM', 'No ai/ folder in this project.', 'Run `wekyt install` first.');
  }
  const cfgPath = configFilePath(projectDir);
  if (fs.existsSync(cfgPath) && !opts.force) {
    throw new WekytError(
      'INIT_EXISTS',
      'wekyt.config.json already exists in ./ai/.',
      'Run `wekyt init --force` to replace it, or edit ./ai/wekyt.config.json by hand.',
    );
  }
  const config: ProjectConfig = {harness, configVersion: CONFIG_VERSION};
  fs.writeFileSync(cfgPath, JSON.stringify(config, null, 2) + '\n');

  const info = harnessInfo(harness);
  const bridgeAbs = path.join(projectDir, ...info.bridgePath.split(path.sep));
  let bridgeCreated = false;
  if (!fs.existsSync(bridgeAbs)) {
    fs.mkdirSync(path.dirname(bridgeAbs), {recursive: true});
    fs.writeFileSync(bridgeAbs, bridgeContent(harness));
    bridgeCreated = true;
  }
  return {harness, configPath: cfgPath, bridgePath: bridgeAbs, bridgeCreated, snippet: bridgeSnippet(harness)};
}
