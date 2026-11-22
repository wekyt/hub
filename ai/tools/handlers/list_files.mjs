#!/usr/bin/env node
// list_files: list files under the project root, optionally filtered by a
// glob pattern. Files only, no directories. Symlinks are never followed.
// Secret files are skipped silently. Contract: ai/tools/list_files.yaml
import * as fs from 'node:fs';
import * as path from 'node:path';
import {ToolError, checkInput, enforceRole, isSecretPath, main, projectRoot} from './_lib.mjs';

export const TOOL_ID = 'list_files';
export const ALLOWED_ROLES = ['orchestrator', 'architect', 'dev', 'qa', 'security'];
export const TIMEOUT_SECONDS = 30;
export const UNDERLYING_COMMAND = 'node:fs readdirSync+statSync';

const INPUT = {
  type: 'object',
  properties: {
    pattern: {type: 'string', default: '**'},
    includeHidden: {type: 'boolean', default: false},
    maxResults: {type: 'integer', minimum: 1, maximum: 1000, default: 200},
  },
  additionalProperties: false,
};

const SKIPPED_DIRS = new Set(['.git', 'node_modules']);

/** Small glob matcher: ** matches any characters including /, * any except /, ? one except /. */
export function globToRegExp(pattern) {
  let out = '^';
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === '*' && pattern[i + 1] === '*') {
      if (pattern[i + 2] === '/') {
        out += '(?:[^/]+/)*';
        i += 3;
      } else {
        out += '.*';
        i += 2;
      }
    } else if (c === '*') {
      out += '[^/]*';
      i += 1;
    } else if (c === '?') {
      out += '[^/]';
      i += 1;
    } else if ('\\.+^${}()|[]'.includes(c)) {
      out += '\\' + c;
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  out += '$';
  try {
    return new RegExp(out);
  } catch {
    throw new ToolError('INVALID_PATTERN', 'Invalid file pattern. Use * for a name segment, ** for any depth, and ? for one character.');
  }
}

function walk(dir, rel, includeHidden, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, {withFileTypes: true});
  } catch {
    return;
  }
  for (const entry of entries) {
    if (SKIPPED_DIRS.has(entry.name)) continue;
    if (!includeHidden && entry.name.startsWith('.')) continue;
    const childRel = rel ? `${rel}/${entry.name}` : entry.name;
    const childAbs = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      walk(childAbs, childRel, includeHidden, out);
    } else if (entry.isFile()) {
      out.push(childRel);
    }
  }
}

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const match = globToRegExp(input.pattern);
  const all = [];
  walk(root, '', input.includeHidden, all);
  const files = [];
  let truncated = false;
  for (const rel of all.sort()) {
    if (isSecretPath(rel)) continue;
    if (!match.test(rel)) continue;
    if (files.length >= input.maxResults) {
      truncated = true;
      break;
    }
    let bytes = 0;
    try {
      bytes = fs.statSync(path.join(root, rel)).size;
    } catch {
      continue;
    }
    files.push({path: rel, bytes});
  }
  return {pattern: input.pattern, files, truncated};
});
