import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export class WekytError extends Error {
  code: string;
  fix?: string;
  constructor(code: string, message: string, fix?: string) {
    super(message);
    this.name = 'WekytError';
    this.code = code;
    this.fix = fix;
  }
}

export function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) < (pb[i] || 0) ? -1 : 1;
  }
  return 0;
}

export function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+$/.test(v.replace(/^v/, ''));
}

export function stripTagPrefix(tag: string): string {
  return tag.replace(/^v/, '');
}

export function sha256File(filePath: string): string {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

/** Parse a SHA256SUMS file. Returns map from file name to hex digest. */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/);
    if (m) out.set(m[2].trim(), m[1].toLowerCase());
  }
  return out;
}

export function wekytHome(): string {
  return path.join(os.homedir(), '.wekyt');
}

export function ensureWekytHome(): string {
  const dir = wekytHome();
  fs.mkdirSync(dir, {recursive: true});
  return dir;
}

export function readJsonFile<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJsonFileAtomic(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), {recursive: true});
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, filePath);
}

/**
 * Executable suffixes tried for a bare command name, in order. On Windows
 * an extensionless file is not runnable through CreateProcess, and the
 * Node distribution ships an extensionless `npm` shell script next to the
 * real npm.cmd shim: the bare name must be tried LAST on win32, or the
 * resolver returns a file Windows cannot run (workflow run #11:
 * spawnSync ...\npm ENOENT). On POSIX the bare name is the norm and
 * stays first. The platform parameter exists only so the win32 branch is
 * unit-testable on other platforms; callers pass nothing.
 */
export function commandSuffixes(platform: NodeJS.Platform = process.platform): string[] {
  return platform === 'win32' ? ['.exe', '.bat', '.cmd', ''] : ['', '.exe', '.cmd'];
}

/**
 * Resolve a command to its absolute path, trying the Windows executable
 * suffixes too. Spawning a bare name fails on Windows when only a .cmd shim
 * exists (CreateProcess appends .exe only), so callers must spawn the
 * resolved path. Returns null when the command is not on PATH.
 */
export function resolveCommand(cmd: string, platform: NodeJS.Platform = process.platform): string | null {
  const pathEnv = process.env.PATH || '';
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    for (const suffix of commandSuffixes(platform)) {
      try {
        const candidate = path.join(dir, cmd + suffix);
        if (fs.statSync(candidate).isFile()) return candidate;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * Spawn options for a resolved command file. Since the CVE-2024-27980 fix,
 * Node refuses to spawn .bat/.cmd files on Windows without a shell
 * (EINVAL): they must run through cmd.exe. .exe files and extensionless
 * files spawn directly. The platform parameter exists only so the win32
 * branch is unit-testable on other platforms; callers pass nothing.
 */
export function shellOptionFor(file: string, platform: NodeJS.Platform = process.platform): {shell?: true} {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) return {shell: true};
  return {};
}

export function commandExists(cmd: string): boolean {
  return resolveCommand(cmd) !== null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
