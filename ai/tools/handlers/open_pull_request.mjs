#!/usr/bin/env node
// open_pull_request: open a pull request from a branch. Idempotent: when an
// open pull request already exists for the head branch, it is returned
// instead of creating a duplicate. Contract: ai/tools/open_pull_request.yaml
import {ToolError, checkInput, enforceRole, ghAuthenticated, githubRequest, githubToken, main, projectRoot, resolveGitHubRepo, runCommand} from './_lib.mjs';

export const TOOL_ID = 'open_pull_request';
export const ALLOWED_ROLES = ['orchestrator', 'dev'];
export const TIMEOUT_SECONDS = 60;
export const UNDERLYING_COMMAND = 'POST https://api.github.com/repos/{owner}/{repo}/pulls';
export const FALLBACK_COMMAND = ['gh', 'pr', 'create', '--title', '<title>', '--body', '<body>', '--head', '<head>', '--base', '<base>'];

const INPUT = {
  type: 'object',
  properties: {
    title: {type: 'string', minLength: 1},
    body: {type: 'string'},
    head: {type: 'string'},
    base: {type: 'string', default: 'main'},
  },
  required: ['title', 'body', 'head'],
  additionalProperties: false,
};

async function openViaApi(owner, repo, input, token) {
  const list = await githubRequest('GET', `/repos/${owner}/${repo}/pulls?head=${owner}:${encodeURIComponent(input.head)}&state=open`, {token});
  if (list.status === 200 && Array.isArray(list.json) && list.json.length > 0) {
    const pr = list.json[0];
    return {number: pr.number, url: pr.html_url, head: input.head, base: input.base};
  }
  const created = await githubRequest('POST', `/repos/${owner}/${repo}/pulls`, {token, body: {title: input.title, body: input.body, head: input.head, base: input.base}});
  if (created.status === 201 && created.json) {
    return {number: created.json.number, url: created.json.html_url, head: input.head, base: input.base};
  }
  if (created.status === 401 || created.status === 403) {
    throw new ToolError('NOT_AUTHENTICATED', 'Not authenticated with GitHub. Run `gh auth login`, or set GITHUB_TOKEN.');
  }
  if (created.status === 404) {
    throw new ToolError('BASE_NOT_FOUND', 'Base branch not found on the remote. Check the base name.');
  }
  if (created.status === 422) {
    const message = String((created.json && (created.json.message || '')) || '');
    if (/base/i.test(message)) {
      throw new ToolError('BASE_NOT_FOUND', 'Base branch not found on the remote. Check the base name.');
    }
    if (/already exists/i.test(message)) {
      const again = await githubRequest('GET', `/repos/${owner}/${repo}/pulls?head=${owner}:${encodeURIComponent(input.head)}&state=open`, {token});
      if (again.status === 200 && Array.isArray(again.json) && again.json.length > 0) {
        const pr = again.json[0];
        return {number: pr.number, url: pr.html_url, head: input.head, base: input.base};
      }
      throw new ToolError('PR_EXISTS', 'A pull request already exists for this branch. Use the existing one.');
    }
    throw new ToolError('INTERNAL_ERROR', `GitHub refused the pull request: ${message.slice(0, 200)}`);
  }
  throw new ToolError('INTERNAL_ERROR', `GitHub returned status ${created.status} while opening the pull request.`);
}

function openViaGh(owner, repo, input) {
  const list = runCommand(['gh', 'pr', 'list', '--head', input.head, '--json', 'number,url', '--repo', `${owner}/${repo}`], {timeoutMs: TIMEOUT_SECONDS * 1000});
  if (list.code === 0) {
    try {
      const found = JSON.parse(list.stdout || '[]');
      if (Array.isArray(found) && found.length > 0) {
        return {number: found[0].number, url: found[0].url, head: input.head, base: input.base};
      }
    } catch {
      // Fall through to create.
    }
  }
  const created = runCommand(['gh', 'pr', 'create', '--title', input.title, '--body', input.body, '--head', input.head, '--base', input.base, '--repo', `${owner}/${repo}`], {timeoutMs: TIMEOUT_SECONDS * 1000});
  const out = (created.stdout || '') + (created.stderr || '');
  if (created.code === 0) {
    const m = out.match(/https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/pull\/(\d+)/);
    if (!m) throw new ToolError('INTERNAL_ERROR', 'gh created the pull request but returned no URL.');
    return {number: parseInt(m[1], 10), url: m[0], head: input.head, base: input.base};
  }
  if (/auth|login|not logged/i.test(out)) {
    throw new ToolError('NOT_AUTHENTICATED', 'Not authenticated with GitHub. Run `gh auth login`, or set GITHUB_TOKEN.');
  }
  if (/already exists/i.test(out)) {
    throw new ToolError('PR_EXISTS', 'A pull request already exists for this branch. Use the existing one.');
  }
  throw new ToolError('INTERNAL_ERROR', `gh pr create failed: ${out.trim().slice(-300)}`);
}

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const {owner, repo} = resolveGitHubRepo(root);
  const token = githubToken();
  if (token) return openViaApi(owner, repo, input, token);
  if (ghAuthenticated()) return openViaGh(owner, repo, input);
  throw new ToolError('NOT_AUTHENTICATED', 'Not authenticated with GitHub. Run `gh auth login`, or set GITHUB_TOKEN.');
});
