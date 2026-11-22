#!/usr/bin/env node
// Shared helpers for tool handlers in this folder. No dependencies, Node
// 22 or later. Every handler reads one JSON object on stdin and writes one
// JSON object on stdout: {ok: true, ...result} on success, and
// {ok: false, error: {code, message, retryable}} with exit code 1 on
// failure. Nothing else goes to stdout.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {spawnSync} from 'node:child_process';

export class ToolError extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

export const ROLES = ['orchestrator', 'architect', 'dev', 'qa', 'security', 'judge'];

/** Project root: WEKYT_PROJECT_ROOT, or the current working directory. */
export function projectRoot() {
  const root = path.resolve(process.env.WEKYT_PROJECT_ROOT || process.cwd());
  try {
    return fs.realpathSync(root);
  } catch {
    return root;
  }
}

/** Read one JSON object from stdin. Empty stdin means {}. */
export async function readInput() {
  if (process.stdin.isTTY) return {};
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ToolError('INVALID_INPUT', 'Input must be one JSON object on stdin.');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ToolError('INVALID_INPUT', 'Input must be one JSON object on stdin.');
  }
  return parsed;
}

/**
 * Role for this call: `_role` in the input JSON wins, then WEKYT_ROLE.
 * The `_role` field is stripped from the input before validation.
 */
export function roleFromInput(raw) {
  let role = null;
  if (typeof raw._role === 'string') role = raw._role;
  else if (process.env.WEKYT_ROLE) role = process.env.WEKYT_ROLE;
  delete raw._role;
  return role;
}

/** Refuse when a role is supplied and is not in the tool allow list. */
export function enforceRole(role, allowedRoles) {
  if (!role) return;
  if (!allowedRoles.includes(role)) {
    throw new ToolError('PERMISSION_DENIED', `Role ${role} may not use this tool.`);
  }
}

/**
 * Validate input against a compact schema subset: type object with
 * properties (type, enum, default, minimum, maximum, minLength, maxLength,
 * pattern, items), required, additionalProperties false. Applies defaults.
 * Throws INVALID_INPUT on the first problem found.
 */
export function checkInput(input, schema) {
  const props = schema.properties || {};
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (input[name] === undefined) {
        throw new ToolError('INVALID_INPUT', `Missing required field: ${name}.`);
      }
    }
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(input)) {
      if (!(key in props)) {
        throw new ToolError('INVALID_INPUT', `Unknown field: ${key}.`);
      }
    }
  }
  for (const [name, spec] of Object.entries(props)) {
    if (input[name] === undefined && spec.default !== undefined) input[name] = spec.default;
    const value = input[name];
    if (value === undefined) continue;
    if (spec.type === 'string' && typeof value !== 'string') {
      throw new ToolError('INVALID_INPUT', `Field ${name} must be a string.`);
    }
    if (spec.type === 'integer' && !Number.isInteger(value)) {
      throw new ToolError('INVALID_INPUT', `Field ${name} must be an integer.`);
    }
    if (spec.type === 'boolean' && typeof value !== 'boolean') {
      throw new ToolError('INVALID_INPUT', `Field ${name} must be a boolean.`);
    }
    if (spec.type === 'array' && !Array.isArray(value)) {
      throw new ToolError('INVALID_INPUT', `Field ${name} must be an array.`);
    }
    if (spec.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
      throw new ToolError('INVALID_INPUT', `Field ${name} must be an object.`);
    }
    if (spec.enum && !spec.enum.includes(value)) {
      throw new ToolError('INVALID_INPUT', `Field ${name} must be one of: ${spec.enum.join(', ')}.`);
    }
    if (typeof value === 'string') {
      if (spec.minLength !== undefined && value.length < spec.minLength) {
        throw new ToolError('INVALID_INPUT', `Field ${name} is too short.`);
      }
      if (spec.maxLength !== undefined && value.length > spec.maxLength) {
        throw new ToolError('INVALID_INPUT', `Field ${name} is too long.`);
      }
      if (spec.pattern && !new RegExp(spec.pattern).test(value)) {
        throw new ToolError('INVALID_INPUT', `Field ${name} does not match the required pattern.`);
      }
    }
    if (typeof value === 'number') {
      if (spec.minimum !== undefined && value < spec.minimum) {
        throw new ToolError('INVALID_INPUT', `Field ${name} is below the minimum ${spec.minimum}.`);
      }
      if (spec.maximum !== undefined && value > spec.maximum) {
        throw new ToolError('INVALID_INPUT', `Field ${name} is above the maximum ${spec.maximum}.`);
      }
    }
    if (Array.isArray(value) && spec.items) {
      for (const item of value) {
        if (spec.items.enum && !spec.items.enum.includes(item)) {
          throw new ToolError('INVALID_INPUT', `Field ${name} has an item that is not one of: ${spec.items.enum.join(', ')}.`);
        }
        if (spec.items.type === 'string' && typeof item !== 'string') {
          throw new ToolError('INVALID_INPUT', `Field ${name} must contain strings only.`);
        }
      }
    }
  }
}

const SECRET_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg']);

/**
 * Secret path, per the hard rules in permissions.md: .env files, *.pem,
 * *.key, id_* private keys, any path segment containing credentials or
 * secret, and anything under .ssh, .aws or .gnupg.
 */
export function isSecretPath(rel) {
  const segments = rel.split('/');
  const base = segments[segments.length - 1];
  if (base === '.env' || base.startsWith('.env.')) return true;
  if (/\.pem$/i.test(base) || /\.key$/i.test(base)) return true;
  if (/^(id_rsa|id_ed25519|id_ecdsa|id_dsa)/.test(base)) return true;
  if (base === '.netrc') return true;
  for (const segment of segments) {
    if (SECRET_SEGMENTS.has(segment)) return true;
    if (/credentials/i.test(segment) || /secret/i.test(segment)) return true;
  }
  return false;
}

/**
 * Resolve a relative path inside the project root. Refuses absolute paths,
 * `..` escapes, and symlinks that leave the root. Throws ToolError with
 * PATH_OUTSIDE_PROJECT or SECRET_PATH.
 */
export function resolveInside(root, rel) {
  if (typeof rel !== 'string' || !rel) {
    throw new ToolError('PATH_OUTSIDE_PROJECT', 'Path must be a non-empty relative path.');
  }
  if (path.isAbsolute(rel)) {
    throw new ToolError('PATH_OUTSIDE_PROJECT', 'Path outside the project root. Use a path inside the project.');
  }
  const abs = path.resolve(root, rel);
  const relToRoot = path.relative(root, abs);
  if (relToRoot.startsWith('..') || path.isAbsolute(relToRoot)) {
    throw new ToolError('PATH_OUTSIDE_PROJECT', 'Path outside the project root. Use a path inside the project.');
  }
  if (isSecretPath(relToRoot.split(path.sep).join('/'))) {
    throw new ToolError('SECRET_PATH', 'Secret paths are off limits for every role.');
  }
  let current = root;
  for (const segment of relToRoot.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (fs.existsSync(current)) {
      const real = fs.realpathSync(current);
      const realRel = path.relative(root, real);
      if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
        throw new ToolError('PATH_OUTSIDE_PROJECT', 'Path outside the project root. Use a path inside the project.');
      }
    }
  }
  return abs;
}

/** True when the buffer holds a NUL byte in its first 8 KB: binary content. */
export function isBinaryBuffer(buf) {
  return buf.subarray(0, 8192).includes(0);
}

/**
 * Resolve a command to its absolute path, trying the Windows executable
 * suffixes too. Spawning a bare name fails on Windows when only a .cmd shim
 * exists (CreateProcess appends .exe only, so plain `npm` is never found),
 * so callers must spawn the resolved path. Returns null when the command
 * is not on PATH. Mirrors the CLI resolver in cli/src/lib/util.ts.
 */
export function resolveCommand(cmd) {
  const pathEnv = process.env.PATH || '';
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const suffix of ['', '.exe', '.cmd']) {
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
export function shellOptionFor(file, platform = process.platform) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) return {shell: true};
  return {};
}

/**
 * Run a command synchronously with a timeout. Returns
 * {code, stdout, stderr, timedOut, signal}. A missing binary throws
 * INTERNAL_ERROR. A timeout kills the process and reports timedOut.
 * The command name is resolved on PATH first (see resolveCommand), so
 * .cmd shims such as npm on Windows are found and run through a shell.
 */
export function runCommand(argv, {cwd, timeoutMs, maxBuffer = 1024 * 1024, env} = {}) {
  let file = argv[0];
  if (!file.includes('/') && !file.includes('\\')) {
    const resolved = resolveCommand(file);
    if (!resolved) {
      throw new ToolError('INTERNAL_ERROR', `Cannot run ${file}: spawnSync ${file} ENOENT`);
    }
    file = resolved;
  }
  let result;
  try {
    result = spawnSync(file, argv.slice(1), {
      cwd,
      timeout: timeoutMs,
      maxBuffer,
      encoding: 'utf8',
      env: {...process.env, ...env},
      ...shellOptionFor(file),
    });
  } catch (e) {
    throw new ToolError('INTERNAL_ERROR', `Cannot run ${argv[0]}: ${e.message}`);
  }
  if (result.error && result.error.code === 'ETIMEDOUT') {
    return {code: null, stdout: result.stdout || '', stderr: result.stderr || '', timedOut: true, signal: null};
  }
  if (result.error) {
    throw new ToolError('INTERNAL_ERROR', `Cannot run ${argv[0]}: ${result.error.message}`);
  }
  return {code: result.status, stdout: result.stdout || '', stderr: result.stderr || '', timedOut: false, signal: result.signal};
}

/** True when a command exists on PATH (PATH scan, no execution). */
export function commandExists(name) {
  return resolveCommand(name) !== null;
}

/** Read package.json in the project root, or null when it is missing or invalid. */
export function readPackageJson(root) {
  const p = path.join(root, 'package.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Parse a git remote URL into {owner, repo} for github.com, or null. */
export function parseGitHubRemote(url) {
  if (!url) return null;
  const text = url.trim();
  let m = text.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (m) return {owner: m[1], repo: m[2]};
  m = text.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (m) return {owner: m[1], repo: m[2]};
  return null;
}

/** Owner and repo from the project git remote. Throws NO_GITHUB_REMOTE. */
export function resolveGitHubRepo(root) {
  const r = runCommand(['git', 'remote', 'get-url', 'origin'], {cwd: root, timeoutMs: 10000});
  const parsed = r.code === 0 ? parseGitHubRemote((r.stdout || '').trim()) : null;
  if (!parsed) {
    throw new ToolError('NO_GITHUB_REMOTE', 'No GitHub remote configured. Set the origin remote to a github.com repository first.');
  }
  return parsed;
}

/** GitHub token from GITHUB_TOKEN, or null when unset. */
export function githubToken() {
  return process.env.GITHUB_TOKEN || null;
}

/** True when the gh CLI is installed and has a logged in session. */
export function ghAuthenticated() {
  if (!commandExists('gh')) return false;
  const r = runCommand(['gh', 'auth', 'status'], {timeoutMs: 10000});
  return r.code === 0;
}

/**
 * One GitHub REST call. Base URL comes from WEKYT_GITHUB_API_URL
 * (default https://api.github.com) so tests can point at a stub server.
 * Returns {status, json}. Network failures throw INTERNAL_ERROR.
 */
export async function githubRequest(method, apiPath, {token, body} = {}) {
  const base = (process.env.WEKYT_GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60000);
  try {
    const res = await fetch(base + apiPath, {
      method,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'wekyt-tools/0.4.0',
        ...(token ? {Authorization: `Bearer ${token}`} : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return {status: res.status, json};
  } catch (e) {
    if (e.name === 'AbortError') throw new ToolError('INTERNAL_ERROR', 'GitHub request timed out.', true);
    throw new ToolError('INTERNAL_ERROR', `GitHub request failed: ${e.message}`, true);
  } finally {
    clearTimeout(timer);
  }
}

/** Parse "N passing", "N failing", "N pending" counts from runner output. */
export function parseTestCounts(output) {
  const find = (re) => {
    const m = output.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  // Mocha and Jest print "N passing", "N failing", "N pending". The Node
  // test runner prints "pass N", "fail N", "skipped N" in its summary.
  return {
    passedCount: find(/(\d+) passing/) || find(/pass (\d+)/),
    failedCount: find(/(\d+) failing/) || find(/fail (\d+)/),
    skippedCount: find(/(\d+) pending/) || find(/skipped (\d+)/),
  };
}

/** Parse `file:line: message` lines into violation objects, best effort. */
export function parseViolationLines(output) {
  const violations = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^(.+?):(\d+):(\d+):\s+(.*)$/);
    if (!m) continue;
    const severity = /warning/i.test(m[4]) ? 'warning' : 'error';
    violations.push({file: m[1], line: parseInt(m[2], 10), column: parseInt(m[3], 10), rule: '', message: m[4], severity});
  }
  return violations;
}

/** Parse `file:line: message` lines into checker findings, best effort. */
export function parseFindingLines(output, check) {
  const findings = [];
  for (const line of output.split('\n')) {
    const m = line.match(/^(.+?):(\d+):\s+(.*)$/);
    if (!m || /^\s*\d+ passing/.test(line)) continue;
    findings.push({file: m[1], line: parseInt(m[2], 10), check, message: m[3], severity: 'blocking'});
  }
  return findings;
}

/** Entry point wrapper for handlers: read input, run fn, write the envelope. */
export async function main(fn) {
  try {
    const raw = await readInput();
    const role = roleFromInput(raw);
    const result = await fn(raw, role);
    process.stdout.write(JSON.stringify({ok: true, ...result}) + '\n');
  } catch (e) {
    if (e instanceof ToolError) {
      process.stdout.write(JSON.stringify({ok: false, error: {code: e.code, message: e.message, retryable: e.retryable}}) + '\n');
    } else {
      process.stdout.write(JSON.stringify({ok: false, error: {code: 'INTERNAL_ERROR', message: String((e && e.message) || e), retryable: false}}) + '\n');
    }
    process.exitCode = 1;
  }
}
