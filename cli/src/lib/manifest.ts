// Manifest of the files a release installed into ./ai/.
// update and install --force use it to tell team files apart from files the
// user added or edited. A file listed here belongs to the release; anything
// else in ai/ belongs to the user and is never deleted or overwritten.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {sha256File} from './util';

export const MANIFEST_NAME = '.wekyt-manifest.json';

export interface Manifest {
  version: string;
  installedAt: string;
  /** Relative posix path inside ai/ to SHA-256 hex. The manifest itself is not listed. */
  files: Record<string, string>;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** All files under a dir, as posix relative paths, excluding the manifest itself. */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name !== MANIFEST_NAME) out.push(toPosix(path.relative(dir, p)));
    }
  };
  walk(dir);
  return out.sort();
}

export function hashFiles(aiDir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const rel of listFilesRecursive(aiDir)) {
    files[rel] = sha256File(path.join(aiDir, ...rel.split('/')));
  }
  return files;
}

export function buildManifest(aiDir: string, version: string): Manifest {
  return {version, installedAt: new Date().toISOString(), files: hashFiles(aiDir)};
}

export function manifestPath(aiDir: string): string {
  return path.join(aiDir, MANIFEST_NAME);
}

export function writeManifest(aiDir: string, manifest: Manifest): void {
  fs.writeFileSync(manifestPath(aiDir), JSON.stringify(manifest, null, 2) + '\n');
}

export function readManifest(aiDir: string): Manifest | null {
  const p = manifestPath(aiDir);
  if (!fs.existsSync(p)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf8')) as Manifest;
    if (typeof data.version !== 'string' || typeof data.files !== 'object' || data.files === null) return null;
    return data;
  } catch {
    return null;
  }
}

/** Files in ai/ that no manifest lists: user skills, local configs, backups. */
export function listUserFiles(aiDir: string): string[] {
  const manifest = readManifest(aiDir);
  const all = listFilesRecursive(aiDir);
  if (!manifest) return all;
  const tracked = new Set(Object.keys(manifest.files));
  return all.filter((rel) => !tracked.has(rel));
}

export type TrackedStatus = 'unchanged' | 'modified' | 'missing';

/** For each file a manifest lists, say whether the user changed or deleted it. */
export function classifyTracked(aiDir: string, manifest: Manifest): {rel: string; status: TrackedStatus}[] {
  const out: {rel: string; status: TrackedStatus}[] = [];
  for (const rel of Object.keys(manifest.files).sort()) {
    const p = path.join(aiDir, ...rel.split('/'));
    if (!fs.existsSync(p)) {
      out.push({rel, status: 'missing'});
    } else if (sha256File(p) !== manifest.files[rel]) {
      out.push({rel, status: 'modified'});
    } else {
      out.push({rel, status: 'unchanged'});
    }
  }
  return out;
}
