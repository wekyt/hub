#!/usr/bin/env node
// merge_pull_request: merge an approved pull request. Only the orchestrator
// merge step may use it, only when every layer agreed, and only when an
// audit entry recording that agreement was written before the merge runs.
// Contract: ai/tools/merge_pull_request.yaml
import * as fs from 'node:fs';
import * as path from 'node:path';
import {ToolError, checkInput, enforceRole, ghAuthenticated, githubRequest, githubToken, main, projectRoot, resolveGitHubRepo, runCommand} from './_lib.mjs';

export const TOOL_ID = 'merge_pull_request';
export const ALLOWED_ROLES = ['orchestrator'];
export const TIMEOUT_SECONDS = 60;
export const UNDERLYING_COMMAND = 'PUT https://api.github.com/repos/{owner}/{repo}/pulls/{number}/merge';
export const FALLBACK_COMMAND = ['gh', 'pr', 'merge', '<number>', '--merge'];

const INPUT = {
  type: 'object',
  properties: {
    number: {type: 'integer', minimum: 1},
    method: {type: 'string', enum: ['merge', 'squash', 'rebase'], default: 'merge'},
    agreement: {type: 'object'},
  },
  required: ['number'],
  additionalProperties: false,
};

const LAYERS = ['architect', 'dev', 'qa', 'qaTestsGreen', 'security'];

function checkAgreement(input) {
  const agreement = input.agreement;
  if (!agreement || typeof agreement !== 'object') return false;
  return LAYERS.every((layer) => agreement[layer] === true);
}

function checkAuditEntry(root, number) {
  const logPath = path.join(root, 'ai', 'audit.log');
  if (!fs.existsSync(logPath)) return false;
  let text;
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch {
    return false;
  }
  for (const line of text.split('\n')) {
    if (!line.includes('"action":"merge"')) continue;
    if (line.includes(`PR ${number}`) || line.includes(`#${number}`)) return true;
  }
  return false;
}

async function mergeViaApi(owner, repo, input, token) {
  const res = await githubRequest('PUT', `/repos/${owner}/${repo}/pulls/${input.number}/merge`, {token, body: {merge_method: input.method}});
  if (res.status === 200 && res.json && res.json.merged) {
    return {merged: true, sha: res.json.merge_commit_sha || res.json.sha || '', number: input.number};
  }
  if (res.status === 401 || res.status === 403) {
    throw new ToolError('NOT_AUTHENTICATED', 'Not authenticated with GitHub. Run `gh auth login`, or set GITHUB_TOKEN.');
  }
  if (res.status === 404) {
    throw new ToolError('PR_NOT_FOUND', `Pull request ${input.number} was not found.`);
  }
  if (res.status === 405 || res.status === 409) {
    throw new ToolError('MERGE_CONFLICT', 'Merge conflict. Return the branch to the dev to resolve it.');
  }
  if (res.json && res.json.merged === false) {
    throw new ToolError('MERGE_CONFLICT', 'Merge conflict. Return the branch to the dev to resolve it.');
  }
  throw new ToolError('INTERNAL_ERROR', `GitHub returned status ${res.status} while merging the pull request.`);
}

function mergeViaGh(owner, repo, input) {
  const flag = input.method === 'squash' ? '--squash' : input.method === 'rebase' ? '--rebase' : '--merge';
  const merged = runCommand(['gh', 'pr', 'merge', String(input.number), flag, '--repo', `${owner}/${repo}`], {timeoutMs: TIMEOUT_SECONDS * 1000});
  const out = (merged.stdout || '') + (merged.stderr || '');
  if (merged.code !== 0) {
    if (/auth|login|not logged/i.test(out)) {
      throw new ToolError('NOT_AUTHENTICATED', 'Not authenticated with GitHub. Run `gh auth login`, or set GITHUB_TOKEN.');
    }
    if (/conflict/i.test(out)) {
      throw new ToolError('MERGE_CONFLICT', 'Merge conflict. Return the branch to the dev to resolve it.');
    }
    throw new ToolError('INTERNAL_ERROR', `gh pr merge failed: ${out.trim().slice(-300)}`);
  }
  const viewed = runCommand(['gh', 'pr', 'view', String(input.number), '--json', 'mergeCommit', '--jq', '.mergeCommit.oid', '--repo', `${owner}/${repo}`], {timeoutMs: 10000});
  const sha = viewed.code === 0 ? (viewed.stdout || '').trim() : '';
  return {merged: true, sha, number: input.number};
}

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  if (!checkAgreement(input)) {
    throw new ToolError('LAYERS_NOT_AGREED', 'Not all layers agreed. Return the work to the layer that disagrees instead of merging.');
  }
  const root = projectRoot();
  if (!checkAuditEntry(root, input.number)) {
    throw new ToolError('NO_AUDIT_ENTRY', 'A merge without an audit entry is forbidden. Write the audit entry first.');
  }
  const {owner, repo} = resolveGitHubRepo(root);
  const token = githubToken();
  if (token) return mergeViaApi(owner, repo, input, token);
  if (ghAuthenticated()) return mergeViaGh(owner, repo, input);
  throw new ToolError('NOT_AUTHENTICATED', 'Not authenticated with GitHub. Run `gh auth login`, or set GITHUB_TOKEN.');
});
