#!/usr/bin/env node
// rollback: revert a merged commit with a new revert commit. Never rewrites
// shared history. Runs on the main branch. Contract: ai/tools/rollback.yaml
import {ToolError, checkInput, enforceRole, main, projectRoot, runCommand} from './_lib.mjs';

export const TOOL_ID = 'rollback';
export const ALLOWED_ROLES = ['orchestrator'];
export const TIMEOUT_SECONDS = 120;
export const UNDERLYING_COMMAND = ['git', 'revert', '--no-edit', '<commit>'];

const INPUT = {
  type: 'object',
  properties: {
    commit: {type: 'string'},
    reason: {type: 'string', minLength: 1},
  },
  required: ['commit', 'reason'],
  additionalProperties: false,
};

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const branch = runCommand(['git', 'branch', '--show-current'], {cwd: root, timeoutMs: 10000});
  if ((branch.stdout || '').trim() !== 'main') {
    throw new ToolError('NOT_ON_MAIN', 'Rollback runs on the main branch. Switch to main first.');
  }
  const exists = runCommand(['git', 'cat-file', '-e', input.commit], {cwd: root, timeoutMs: 10000});
  if (exists.code !== 0) {
    throw new ToolError('COMMIT_NOT_FOUND', 'Commit not found. Check the SHA against the merge audit entry.');
  }
  const full = runCommand(['git', 'rev-parse', input.commit], {cwd: root, timeoutMs: 10000});
  const fullSha = (full.stdout || '').trim();
  const subject = runCommand(['git', 'log', '-1', '--format=%s', input.commit], {cwd: root, timeoutMs: 10000});
  const subjectText = (subject.stdout || '').trim();
  const log = runCommand(['git', 'log', '--all', '--format=%s'], {cwd: root, timeoutMs: 10000});
  if (subjectText && (log.stdout || '').split('\n').includes(`Revert "${subjectText}"`)) {
    throw new ToolError('NOTHING_TO_REVERT', 'Commit already reverted. No further rollback is needed.');
  }
  const parents = runCommand(['git', 'cat-file', '-p', input.commit], {cwd: root, timeoutMs: 10000});
  const isMerge = (parents.stdout || '').split('\n').filter((l) => l.startsWith('parent ')).length > 1;
  const argv = isMerge
    ? ['git', 'revert', '--no-edit', '-m', '1', input.commit]
    : ['git', 'revert', '--no-edit', input.commit];
  const result = runCommand(argv, {cwd: root, timeoutMs: TIMEOUT_SECONDS * 1000});
  if (result.code !== 0) {
    const err = (result.stderr || '').trim();
    if (/conflict/i.test(err)) {
      runCommand(['git', 'revert', '--abort'], {cwd: root, timeoutMs: 10000});
      throw new ToolError('REVERT_CONFLICT', 'Revert conflicts with later changes. Resolve it by hand and record the resolution in the audit log.');
    }
    throw new ToolError('INTERNAL_ERROR', `git revert failed: ${err.slice(0, 300)}`);
  }
  const revert = runCommand(['git', 'rev-parse', 'HEAD'], {cwd: root, timeoutMs: 10000});
  return {revertedCommit: fullSha, revertCommit: (revert.stdout || '').trim()};
});
