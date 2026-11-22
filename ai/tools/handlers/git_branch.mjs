#!/usr/bin/env node
// git_branch: create a git branch for a task and switch to it. Never creates
// or switches to main. Contract: ai/tools/git_branch.yaml
import {ToolError, checkInput, enforceRole, main, projectRoot, runCommand} from './_lib.mjs';

export const TOOL_ID = 'git_branch';
export const ALLOWED_ROLES = ['orchestrator', 'dev'];
export const TIMEOUT_SECONDS = 60;
export const UNDERLYING_COMMAND = ['git', 'checkout', '-b', '<name>', '<base>'];

const INPUT = {
  type: 'object',
  properties: {
    name: {type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._/-]*$'},
    base: {type: 'string', default: 'main'},
  },
  required: ['name'],
  additionalProperties: false,
};

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  if (input.name === 'main') {
    throw new ToolError('INVALID_BRANCH_NAME', 'Invalid branch name. Use the task id with lowercase letters, digits, hyphens, dots or slashes.');
  }
  const root = projectRoot();
  const baseCheck = runCommand(['git', 'rev-parse', '--verify', '--quiet', input.base], {cwd: root, timeoutMs: 10000});
  if (baseCheck.code !== 0) {
    throw new ToolError('BASE_NOT_FOUND', `Base ${input.base} does not exist in this repository.`);
  }
  const result = runCommand(['git', 'checkout', '-b', input.name, input.base], {cwd: root, timeoutMs: TIMEOUT_SECONDS * 1000});
  const err = (result.stderr || '').trim();
  if (result.code !== 0) {
    if (/already exists/i.test(err)) {
      throw new ToolError('BRANCH_EXISTS', 'Branch already exists. Use the existing branch, or pick another name.');
    }
    if (/would be overwritten by checkout/i.test(err)) {
      throw new ToolError('DIRTY_TREE', 'Working tree has uncommitted changes. Commit or stash them first.');
    }
    throw new ToolError('INTERNAL_ERROR', `git checkout failed: ${err.slice(0, 300)}`);
  }
  return {branch: input.name, base: input.base};
});
