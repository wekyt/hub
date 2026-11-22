#!/usr/bin/env node
// git_push: push the current branch to the remote. Never pushes main and
// never force pushes. Contract: ai/tools/git_push.yaml
import {ToolError, checkInput, enforceRole, main, projectRoot, runCommand} from './_lib.mjs';

export const TOOL_ID = 'git_push';
export const ALLOWED_ROLES = ['dev'];
export const TIMEOUT_SECONDS = 120;
export const UNDERLYING_COMMAND = ['git', 'push', '<remote>', '<branch>'];

const INPUT = {
  type: 'object',
  properties: {
    remote: {type: 'string', default: 'origin'},
    branch: {type: 'string'},
  },
  additionalProperties: false,
};

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  let branch = input.branch;
  if (!branch) {
    const current = runCommand(['git', 'branch', '--show-current'], {cwd: root, timeoutMs: 10000});
    branch = (current.stdout || '').trim();
  }
  if (!branch) {
    throw new ToolError('NO_UPSTREAM', 'No remote configured. Set the remote for this project first.');
  }
  if (branch === 'main') {
    throw new ToolError('PUSH_TO_MAIN', 'Never push directly to main. Push the task branch and open a pull request.');
  }
  const remoteUrl = runCommand(['git', 'config', `remote.${input.remote}.url`], {cwd: root, timeoutMs: 10000});
  if (remoteUrl.code !== 0 || !(remoteUrl.stdout || '').trim()) {
    throw new ToolError('NO_UPSTREAM', 'No remote configured. Set the remote for this project first.');
  }
  const result = runCommand(['git', 'push', input.remote, branch], {cwd: root, timeoutMs: TIMEOUT_SECONDS * 1000});
  const out = (result.stdout || '') + (result.stderr || '');
  if (result.code !== 0) {
    throw new ToolError('REMOTE_REJECTED', `Remote rejected the push. Pull with rebase first, then push again. ${out.trim().slice(-300)}`, true);
  }
  const pushed = !/everything up-to-date/i.test(out);
  return {remote: input.remote, branch, pushed};
});
