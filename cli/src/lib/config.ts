import * as fs from 'node:fs';
import * as path from 'node:path';
import {ensureWekytHome, readJsonFile, wekytHome, writeJsonFileAtomic} from './util';
import {DEFAULT_CHANNEL, type Channel} from '../version';

export interface WekytConfig {
  autoUpdatesChannel: Channel;
  minimumVersion?: string;
  installMethod?: string;
}

export interface UpdateState {
  lastCheck: string;
  latestKnown?: string;
  lastAttempt?: string;
  lastAttemptOk?: boolean;
  lastAttemptError?: string;
}

export interface UpdateNotice {
  from: string;
  to: string;
  seen: boolean;
  at: string;
}

const DEFAULT_CONFIG: WekytConfig = {autoUpdatesChannel: DEFAULT_CHANNEL};

export function configPath(): string {
  return path.join(wekytHome(), 'config.json');
}

export function loadConfig(): WekytConfig {
  const cfg = readJsonFile<WekytConfig>(configPath(), DEFAULT_CONFIG);
  if (cfg.autoUpdatesChannel !== 'latest' && cfg.autoUpdatesChannel !== 'stable') {
    cfg.autoUpdatesChannel = DEFAULT_CHANNEL;
  }
  return cfg;
}

export function saveConfig(patch: Partial<WekytConfig>): WekytConfig {
  const cfg = {...loadConfig(), ...patch};
  ensureWekytHome();
  writeJsonFileAtomic(configPath(), cfg);
  return cfg;
}

export function statePath(): string {
  return path.join(wekytHome(), 'update-state.json');
}

export function loadState(): UpdateState {
  return readJsonFile<UpdateState>(statePath(), {lastCheck: ''});
}

export function saveState(patch: Partial<UpdateState>): UpdateState {
  const state = {...loadState(), ...patch};
  ensureWekytHome();
  writeJsonFileAtomic(statePath(), state);
  return state;
}

export function noticePath(): string {
  return path.join(wekytHome(), 'update-notice.json');
}

export function loadNotice(): UpdateNotice | null {
  if (!fs.existsSync(noticePath())) return null;
  return readJsonFile<UpdateNotice | null>(noticePath(), null);
}

export function saveNotice(notice: UpdateNotice): void {
  ensureWekytHome();
  writeJsonFileAtomic(noticePath(), notice);
}

export function clearNotice(): void {
  try {
    fs.unlinkSync(noticePath());
  } catch {
    // already gone
  }
}

export function autoUpdateDisabled(): boolean {
  return process.env.WEKYT_NO_AUTO_UPDATE === '1';
}
