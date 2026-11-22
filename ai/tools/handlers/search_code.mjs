#!/usr/bin/env node
// search_code: search the codebase by text or regular expression and return
// matching lines with file and line number. ripgrep first, grep as fallback.
// Contract: ai/tools/search_code.yaml
import {ToolError, checkInput, commandExists, enforceRole, isSecretPath, main, projectRoot, runCommand} from './_lib.mjs';

export const TOOL_ID = 'search_code';
export const ALLOWED_ROLES = ['orchestrator', 'architect', 'dev', 'qa', 'security'];
export const TIMEOUT_SECONDS = 60;
export const UNDERLYING_COMMAND = ['rg', '--no-heading', '--line-number', '--max-count', '50', '<query>', '.'];
export const FALLBACK_COMMAND = ['grep', '-rn', '<query>', '.'];

const INPUT = {
  type: 'object',
  properties: {
    query: {type: 'string', minLength: 1},
    filePattern: {type: 'string'},
    caseSensitive: {type: 'boolean', default: false},
    maxResults: {type: 'integer', minimum: 1, maximum: 500, default: 50},
  },
  required: ['query'],
  additionalProperties: false,
};

function parseLines(output) {
  const matches = [];
  for (const line of output.split('\n')) {
    if (!line) continue;
    const m = line.match(/^(.+?):(\d+):(.*)$/s);
    if (!m) continue;
    // ripgrep prints ./a.txt when the search path is '.', normalize it.
    const file = m[1].startsWith('./') ? m[1].slice(2) : m[1];
    matches.push({file, line: parseInt(m[2], 10), text: m[3]});
  }
  return matches;
}

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const timeoutMs = TIMEOUT_SECONDS * 1000;
  let result;
  let usedGrep = false;
  if (commandExists('rg')) {
    const argv = ['rg', '--no-heading', '--line-number', '--max-count', String(input.maxResults)];
    if (!input.caseSensitive) argv.push('-i');
    if (input.filePattern) argv.push('--glob', input.filePattern);
    argv.push('--', input.query, '.');
    result = runCommand(argv, {cwd: root, timeoutMs});
    if (result.code === 2) {
      throw new ToolError('INVALID_PATTERN', 'Invalid search pattern. Fix the regular expression and try again.');
    }
  } else {
    usedGrep = true;
    const argv = ['grep', '-rn', '--exclude-dir=.git', '--exclude-dir=node_modules'];
    if (!input.caseSensitive) argv.push('-i');
    if (input.filePattern) {
      const base = input.filePattern.split('/').pop();
      if (base) argv.push('--include', base);
    }
    argv.push('--', input.query, '.');
    result = runCommand(argv, {cwd: root, timeoutMs});
    if (result.code === 2) {
      throw new ToolError('INVALID_PATTERN', 'Invalid search pattern. Fix the regular expression and try again.');
    }
  }
  if (result.timedOut) {
    throw new ToolError('SEARCH_TIMEOUT', 'Search timed out. Narrow the file pattern and try again.', true);
  }
  if (result.code === 1) {
    throw new ToolError('NO_MATCHES', 'No matches. Broaden the query or check the file pattern.');
  }
  if (result.code !== 0) {
    throw new ToolError('INTERNAL_ERROR', `Search failed with exit code ${result.code}: ${(result.stderr || '').trim().slice(0, 200)}`);
  }
  const all = parseLines(result.stdout + result.stderr).filter((m) => !isSecretPath(m.file));
  const truncated = all.length > input.maxResults;
  const matches = all.slice(0, input.maxResults);
  if (matches.length === 0) {
    throw new ToolError('NO_MATCHES', 'No matches. Broaden the query or check the file pattern.');
  }
  return {query: input.query, matches, truncated};
});
