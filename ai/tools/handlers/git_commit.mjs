#!/usr/bin/env node
// git_commit: commit staged changes on the current branch with a clear
// message. Commits only what is already staged. Never commits on main.
// Contract: ai/tools/git_commit.yaml
import {ToolError, checkInput, enforceRole, main, projectRoot, runCommand} from './_lib.mjs';

export const TOOL_ID = 'git_commit';
export const ALLOWED_ROLES = ['dev'];
export const TIMEOUT_SECONDS = 60;
export const UNDERLYING_COMMAND = ['git', 'commit', '-m', '<message>'];

const INPUT = {
  type: 'object',
  properties: {
    message: {type: 'string', minLength: 1},
    amend: {type: 'boolean', default: false},
  },
  required: ['message'],
  additionalProperties: false,
};

function currentBranch(root) {
  const r = runCommand(['git', 'branch', '--show-current'], {cwd: root, timeoutMs: 10000});
  return (r.stdout || '').trim();
}

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const branch = currentBranch(root);
  if (branch === 'main') {
    throw new ToolError('ON_MAIN_BRANCH', 'Never commit directly on main. Create a task branch first.');
  }
  if (input.amend) {
    const upstream = runCommand(['git', 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {cwd: root, timeoutMs: 10000});
    if (upstream.code === 0) {
      const pushed = runCommand(['git', 'merge-base', '--is-ancestor', 'HEAD', '@{u}'], {cwd: root, timeoutMs: 10000});
      if (pushed.code === 0) {
        throw new ToolError('AMEND_AFTER_PUSH', 'Cannot amend after push. Create a new commit instead.');
      }
    }
  } else {
    const staged = runCommand(['git', 'diff', '--cached', '--quiet'], {cwd: root, timeoutMs: 10000});
    if (staged.code === 0) {
      throw new ToolError('NOTHING_TO_COMMIT', 'Nothing staged to commit. Stage the intended files first.');
    }
  }
  const argv = input.amend ? ['git', 'commit', '--amend', '-m', input.message] : ['git', 'commit', '-m', input.message];
  const result = runCommand(argv, {cwd: root, timeoutMs: TIMEOUT_SECONDS * 1000});
  if (result.code !== 0) {
    const err = (result.stderr || '').trim();
    if (/nothing to commit/i.test(err)) {
      throw new ToolError('NOTHING_TO_COMMIT', 'Nothing staged to commit. Stage the intended files first.');
    }
    throw new ToolError('INTERNAL_ERROR', `git commit failed: ${err.slice(0, 300)}`);
  }
  const sha = runCommand(['git', 'rev-parse', 'HEAD'], {cwd: root, timeoutMs: 10000});
  return {commit: (sha.stdout || '').trim(), branch: currentBranch(root)};
});
