import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as tar from 'tar';
import {HUB_REPO, RELEASE_CHECKSUMS_NAME, RELEASE_TARBALL_NAME, VERSION} from '../version';
import {WekytError, parseChecksums, sha256File} from './util';

export interface ReleaseInfo {
  tag: string;
  version: string;
  tarballUrl: string;
  checksumsUrl: string | null;
  /** Local tarball path when WEKYT_TARBALL is set. */
  localTarball: string | null;
  /** Local checksums text when WEKYT_SHA256SUMS is set. */
  localChecksums: string | null;
}

const GITHUB_API = `https://api.github.com/repos/${HUB_REPO}/releases`;

async function fetchJson(url: string, timeoutMs = 15000): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {Accept: 'application/vnd.github+json', 'User-Agent': `wekyt-cli/${VERSION}`},
    });
    if (!res.ok) {
      throw new WekytError(
        'RELEASE_FETCH_FAILED',
        `GitHub API returned ${res.status} for ${url}.`,
        'Check the release exists at https://github.com/wekyt/hub/releases, or pass --tag with a published tag.',
      );
    }
    return await res.json();
  } catch (e) {
    if (e instanceof WekytError) throw e;
    throw new WekytError(
      'RELEASE_FETCH_FAILED',
      `Could not reach ${url}: ${e instanceof Error ? e.message : String(e)}.`,
      'Check the network connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

/** Resolve a release. Tag pins a release, otherwise the latest release. */
export async function resolveRelease(tag?: string): Promise<ReleaseInfo> {
  // Test override: a local tarball file, same as install.sh supports.
  const localTarball = process.env.WEKYT_TARBALL || null;
  const localChecksums = process.env.WEKYT_SHA256SUMS
    ? fs.readFileSync(process.env.WEKYT_SHA256SUMS, 'utf8')
    : null;
  if (localTarball) {
    if (!fs.existsSync(localTarball)) {
      throw new WekytError('TARBALL_NOT_FOUND', `WEKYT_TARBALL not found: ${localTarball}.`);
    }
    return {
      tag: tag || 'local',
      version: tag ? tag.replace(/^v/, '') : 'local',
      tarballUrl: '',
      checksumsUrl: null,
      localTarball,
      localChecksums,
    };
  }

  const overrideUrl = process.env.WEKYT_RELEASE_URL || null;
  if (overrideUrl) {
    const checksumsUrl = overrideUrl.replace(/[^/]+$/, RELEASE_CHECKSUMS_NAME);
    return {
      tag: tag || 'override',
      version: tag ? tag.replace(/^v/, '') : 'override',
      tarballUrl: overrideUrl,
      checksumsUrl,
      localTarball: null,
      localChecksums,
    };
  }

  const url = tag ? `${GITHUB_API}/tags/${encodeURIComponent(tag)}` : `${GITHUB_API}/latest`;
  const data = (await fetchJson(url)) as GithubRelease;
  const tarball = data.assets?.find((a) => a.name === RELEASE_TARBALL_NAME);
  if (!tarball) {
    throw new WekytError(
      'NO_TARBALL_ASSET',
      `Release ${data.tag_name} has no ${RELEASE_TARBALL_NAME} asset.`,
      'The release must publish wekyt-hub.tar.gz. See cli/PUBLISHING.md.',
    );
  }
  const checksums = data.assets?.find((a) => a.name === RELEASE_CHECKSUMS_NAME);
  return {
    tag: data.tag_name,
    version: data.tag_name.replace(/^v/, ''),
    tarballUrl: tarball.browser_download_url,
    checksumsUrl: checksums ? checksums.browser_download_url : null,
    localTarball: null,
    localChecksums,
  };
}

/** Download a URL to a file. Supports http(s) and file:// URLs. */
export async function downloadToFile(url: string, dest: string, timeoutMs = 60000): Promise<void> {
  if (url.startsWith('file://')) {
    fs.copyFileSync(new URL(url), dest);
    return;
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {signal: ctrl.signal, headers: {'User-Agent': `wekyt-cli/${VERSION}`}});
    if (!res.ok || !res.body) {
      throw new WekytError('DOWNLOAD_FAILED', `Download returned ${res.status} for ${url}.`);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(dest, buf);
  } catch (e) {
    if (e instanceof WekytError) throw e;
    throw new WekytError(
      'DOWNLOAD_FAILED',
      `Could not download ${url}: ${e instanceof Error ? e.message : String(e)}.`,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  if (url.startsWith('file://')) {
    return fs.readFileSync(new URL(url), 'utf8');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {signal: ctrl.signal, headers: {'User-Agent': `wekyt-cli/${VERSION}`}});
    if (!res.ok) throw new WekytError('DOWNLOAD_FAILED', `Download returned ${res.status} for ${url}.`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Verify the tarball SHA-256 against the release SHA256SUMS file.
 * Fails closed: if the release publishes no SHA256SUMS file, nothing is
 * installed. Release v0.1.0 has no checksums file, so installs from it are
 * refused until a release publishes SHA256SUMS (planned for v0.2.0).
 */
export async function verifyTarball(
  tarballPath: string,
  release: ReleaseInfo,
): Promise<{sha256: string; checksumsSource: string}> {
  let sumsText: string | null = release.localChecksums;
  let source = 'WEKYT_SHA256SUMS';
  if (!sumsText && release.checksumsUrl) {
    try {
      sumsText = await fetchText(release.checksumsUrl);
      source = release.checksumsUrl;
    } catch {
      sumsText = null;
    }
  }
  // Local tarball next to a SHA256SUMS file, same naming as the release.
  if (!sumsText && release.localTarball) {
    const sibling = path.join(path.dirname(release.localTarball), RELEASE_CHECKSUMS_NAME);
    if (fs.existsSync(sibling)) {
      sumsText = fs.readFileSync(sibling, 'utf8');
      source = sibling;
    }
  }
  if (!sumsText) {
    throw new WekytError(
      'NO_CHECKSUMS',
      `Release ${release.tag} publishes no ${RELEASE_CHECKSUMS_NAME} file, so the tarball cannot be verified. Nothing was installed.`,
      `The release must publish a SHA256SUMS file (planned for v0.2.0). For a local test, set WEKYT_SHA256SUMS to a checksums file.`,
    );
  }
  const sums = parseChecksums(sumsText);
  const expected = sums.get(RELEASE_TARBALL_NAME);
  if (!expected) {
    throw new WekytError(
      'NO_CHECKSUMS',
      `${RELEASE_CHECKSUMS_NAME} has no entry for ${RELEASE_TARBALL_NAME}. Nothing was installed.`,
    );
  }
  const actual = sha256File(tarballPath);
  if (actual !== expected) {
    throw new WekytError(
      'CHECKSUM_MISMATCH',
      `SHA-256 mismatch for ${RELEASE_TARBALL_NAME}: expected ${expected}, got ${actual}. Nothing was installed.`,
      'The download may be corrupt or tampered with. Try again, and if it repeats, report it at https://github.com/wekyt/hub/issues.',
    );
  }
  return {sha256: actual, checksumsSource: source};
}

/**
 * Extract a verified tarball into a fresh temp dir and return its ai/ path.
 * Pure JavaScript, no tar binary: the tar package reads the archive, and
 * every entry is checked against Tar Slip before anything is written.
 * Symlinks and hardlinks that point outside the destination are rejected.
 */
export async function extractAi(tarballPath: string): Promise<{workDir: string; aiDir: string}> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-'));
  const dest = path.resolve(workDir);
  try {
    const entries: string[] = [];
    await tar.t({file: tarballPath, onentry: (entry) => entries.push(entry.path)});
    if (!entries.some((p) => p === 'ai/' || p.startsWith('ai/'))) {
      throw new WekytError('BAD_TARBALL', 'Package has no top level ai/ folder. Nothing was installed.');
    }
    await tar.x({
      file: tarballPath,
      cwd: workDir,
      filter: (entryPath, entry) => {
        const resolved = path.resolve(workDir, entryPath);
        if (resolved !== dest && !resolved.startsWith(dest + path.sep)) return false;
        if ('type' in entry && (entry.type === 'SymbolicLink' || entry.type === 'Link') && entry.linkpath) {
          const target = path.resolve(path.dirname(resolved), entry.linkpath);
          if (target !== dest && !target.startsWith(dest + path.sep)) return false;
        }
        return true;
      },
    });
  } catch (e) {
    fs.rmSync(workDir, {recursive: true, force: true});
    if (e instanceof WekytError) throw e;
    throw new WekytError('BAD_TARBALL', 'Package is not a valid gzip tarball. Nothing was installed.');
  }
  return {workDir, aiDir: path.join(workDir, 'ai')};
}

export function sha256Text(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}
