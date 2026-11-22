// Handler tests: every executable tool proves real behavior against a
// fixture temp project. Handlers run as `node ai/tools/handlers/<id>.mjs`
// with JSON on stdin and JSON on stdout, exactly as a harness calls them.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import {commandSuffixes, resolveCommand, runCommand, shellOptionFor} from '../../ai/tools/handlers/_lib.mjs';

const handlersDir = path.resolve(import.meta.dirname, '..', '..', 'ai', 'tools', 'handlers');
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wekyt-handler-'));
}

function runHandler(id, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(handlersDir, `${id}.mjs`)], {
      env: {...process.env, ...env},
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      let out = null;
      try {
        out = JSON.parse(stdout);
      } catch {
        // Leave out null, the assertion below shows stdout.
      }
      resolve({code, out, stdout, stderr});
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function expectOk(res) {
  assert.equal(res.code, 0, `expected exit 0, got ${res.code}: ${res.stdout} ${res.stderr}`);
  assert.equal(res.out.ok, true, `expected ok true: ${res.stdout}`);
  return res.out;
}

function expectErr(res, code) {
  assert.notEqual(res.code, 0, `expected non-zero exit: ${res.stdout}`);
  assert.equal(res.out.ok, false, `expected ok false: ${res.stdout}`);
  assert.equal(res.out.error.code, code, `expected ${code}: ${res.stdout}`);
  assert.equal(typeof res.out.error.message, 'string');
  assert.equal(typeof res.out.error.retryable, 'boolean');
  return res.out.error;
}

function git(cwd, ...args) {
  return execFileSync('git', args, {cwd, env: GIT_ENV, stdio: 'pipe'}).toString();
}

function gitRepo() {
  const dir = tmpDir();
  git(dir, 'init', '-b', 'main');
  fs.writeFileSync(path.join(dir, 'README.md'), '# fixture\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'initial commit');
  return dir;
}

// read_file

test('read_file returns file content', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello world\n');
  const out = expectOk(await runHandler('read_file', {path: 'a.txt'}, {WEKYT_PROJECT_ROOT: dir}));
  assert.equal(out.content, 'hello world\n');
  assert.equal(out.bytes, 12);
  assert.equal(out.truncated, false);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('read_file rejects a missing file, a path escape, a binary file and a secret', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  fs.writeFileSync(path.join(dir, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]));
  fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=abc\n');
  const env = {WEKYT_PROJECT_ROOT: dir};
  expectErr(await runHandler('read_file', {path: 'nope.txt'}, env), 'FILE_NOT_FOUND');
  expectErr(await runHandler('read_file', {path: '../escape.txt'}, env), 'PATH_OUTSIDE_PROJECT');
  expectErr(await runHandler('read_file', {path: '/etc/passwd'}, env), 'PATH_OUTSIDE_PROJECT');
  expectErr(await runHandler('read_file', {path: 'bin.dat'}, env), 'BINARY_FILE');
  expectErr(await runHandler('read_file', {path: '.env'}, env), 'SECRET_PATH');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('read_file truncates long content and reports it', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'long.txt'), 'a'.repeat(5000));
  const out = expectOk(await runHandler('read_file', {path: 'long.txt', maxChars: 100}, {WEKYT_PROJECT_ROOT: dir}));
  assert.equal(out.content.length, 100);
  assert.equal(out.truncated, true);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('read_file enforces the role allow list', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const env = {WEKYT_PROJECT_ROOT: dir};
  expectErr(await runHandler('read_file', {path: 'a.txt', _role: 'judge'}, env), 'PERMISSION_DENIED');
  const out = expectOk(await runHandler('read_file', {path: 'a.txt', _role: 'qa'}, env));
  assert.equal(out.content, 'x');
  fs.rmSync(dir, {recursive: true, force: true});
});

// write_file

test('write_file creates, overwrites, and refuses create on an existing file', async () => {
  const dir = tmpDir();
  const env = {WEKYT_PROJECT_ROOT: dir};
  const created = expectOk(await runHandler('write_file', {path: 'sub/b.txt', content: 'new', mode: 'create'}, env));
  assert.equal(created.created, true);
  assert.equal(fs.readFileSync(path.join(dir, 'sub', 'b.txt'), 'utf8'), 'new');
  expectErr(await runHandler('write_file', {path: 'sub/b.txt', content: 'again', mode: 'create'}, env), 'FILE_EXISTS');
  const over = expectOk(await runHandler('write_file', {path: 'sub/b.txt', content: 'over', mode: 'overwrite'}, env));
  assert.equal(over.created, false);
  assert.equal(fs.readFileSync(path.join(dir, 'sub', 'b.txt'), 'utf8'), 'over');
  expectErr(await runHandler('write_file', {path: '.env', content: 'x', mode: 'create'}, env), 'SECRET_PATH');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('write_file refuses a role that may not write', async () => {
  const dir = tmpDir();
  const env = {WEKYT_PROJECT_ROOT: dir, WEKYT_ROLE: 'qa'};
  expectErr(await runHandler('write_file', {path: 'a.txt', content: 'x', mode: 'create'}, env), 'PERMISSION_DENIED');
  fs.rmSync(dir, {recursive: true, force: true});
});

// edit_file

test('edit_file replaces one exact match and reports it', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n');
  const out = expectOk(await runHandler('edit_file', {path: 'a.txt', oldText: 'two', newText: 'TWO'}, {WEKYT_PROJECT_ROOT: dir}));
  assert.equal(out.replaced, 1);
  assert.equal(out.matches, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'one\nTWO\nthree\n');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('edit_file refuses ambiguous and missing text, and replaces all on request', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x x x\n');
  const env = {WEKYT_PROJECT_ROOT: dir};
  expectErr(await runHandler('edit_file', {path: 'a.txt', oldText: 'x', newText: 'y'}, env), 'MULTIPLE_MATCHES');
  expectErr(await runHandler('edit_file', {path: 'a.txt', oldText: 'zzz', newText: 'y'}, env), 'TEXT_NOT_FOUND');
  const out = expectOk(await runHandler('edit_file', {path: 'a.txt', oldText: 'x', newText: 'y', replaceAll: true}, env));
  assert.equal(out.replaced, 3);
  assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'y y y\n');
  fs.rmSync(dir, {recursive: true, force: true});
});

// list_files

test('list_files lists matching files and skips node_modules, .git and secrets', async () => {
  const dir = tmpDir();
  fs.mkdirSync(path.join(dir, 'src'), {recursive: true});
  fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), {recursive: true});
  fs.mkdirSync(path.join(dir, '.git'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'src', 'a.mjs'), 'a');
  fs.writeFileSync(path.join(dir, 'src', 'b.txt'), 'b');
  fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'c.mjs'), 'c');
  fs.writeFileSync(path.join(dir, '.git', 'config'), 'g');
  fs.writeFileSync(path.join(dir, '.env'), 's');
  const out = expectOk(await runHandler('list_files', {pattern: '**/*.mjs'}, {WEKYT_PROJECT_ROOT: dir}));
  assert.deepEqual(out.files.map((f) => f.path), ['src/a.mjs']);
  assert.equal(out.truncated, false);
  const all = expectOk(await runHandler('list_files', {pattern: '**/*'}, {WEKYT_PROJECT_ROOT: dir}));
  assert.deepEqual(all.files.map((f) => f.path), ['src/a.mjs', 'src/b.txt']);
  fs.rmSync(dir, {recursive: true, force: true});
});

// search_code

test('search_code finds a match and reports no match as an error', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'needle in here\n');
  fs.writeFileSync(path.join(dir, 'b.txt'), 'nothing here\n');
  const env = {WEKYT_PROJECT_ROOT: dir};
  const out = expectOk(await runHandler('search_code', {query: 'needle'}, env));
  assert.equal(out.matches.length, 1);
  assert.equal(out.matches[0].file, 'a.txt');
  assert.equal(out.matches[0].line, 1);
  assert.match(out.matches[0].text, /needle/);
  expectErr(await runHandler('search_code', {query: 'absent'}, env), 'NO_MATCHES');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('search_code never reports a match inside a secret file', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, '.env'), 'needle=secret\n');
  fs.writeFileSync(path.join(dir, 'a.txt'), 'plain\n');
  const res = await runHandler('search_code', {query: 'needle'}, {WEKYT_PROJECT_ROOT: dir});
  expectErr(res, 'NO_MATCHES');
  fs.rmSync(dir, {recursive: true, force: true});
});

// run_tests, run_linter, run_checker, run_build

function runnerFixture(scripts) {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({name: 'fixture', scripts}, null, 2));
  return dir;
}

test('run_tests runs npm test and reports pass and fail', async () => {
  const passDir = runnerFixture({test: 'node test/a.test.mjs'});
  fs.mkdirSync(path.join(passDir, 'test'));
  fs.writeFileSync(path.join(passDir, 'test', 'a.test.mjs'), "import {test} from 'node:test';\ntest('ok', () => {});\n");
  const pass = expectOk(await runHandler('run_tests', {}, {WEKYT_PROJECT_ROOT: passDir}));
  assert.equal(pass.passed, true);
  assert.equal(pass.failedCount, 0);
  assert.ok(pass.passedCount >= 1);

  const failDir = runnerFixture({test: 'node test/a.test.mjs'});
  fs.mkdirSync(path.join(failDir, 'test'));
  fs.writeFileSync(path.join(failDir, 'test', 'a.test.mjs'), "import {test} from 'node:test';\ntest('bad', () => { throw new Error('boom'); });\n");
  const fail = await runHandler('run_tests', {}, {WEKYT_PROJECT_ROOT: failDir});
  expectErr(fail, 'TESTS_FAILED');

  const noTestDir = runnerFixture({});
  expectErr(await runHandler('run_tests', {}, {WEKYT_PROJECT_ROOT: noTestDir}), 'TOOL_NOT_CONFIGURED');
  fs.rmSync(passDir, {recursive: true, force: true});
  fs.rmSync(failDir, {recursive: true, force: true});
  fs.rmSync(noTestDir, {recursive: true, force: true});
});

test('run_linter parses violations and reports pass and fail', async () => {
  const passDir = runnerFixture({lint: 'node lint.mjs'});
  fs.writeFileSync(path.join(passDir, 'lint.mjs'), "console.log('src/a.ts:3:5: error: fake violation');\n");
  const pass = expectOk(await runHandler('run_linter', {}, {WEKYT_PROJECT_ROOT: passDir}));
  assert.equal(pass.passed, true);
  assert.deepEqual(pass.violations, [
    {file: 'src/a.ts', line: 3, column: 5, rule: '', message: 'error: fake violation', severity: 'error'},
  ]);

  const failDir = runnerFixture({lint: 'node lint.mjs'});
  fs.writeFileSync(path.join(failDir, 'lint.mjs'), "console.log('src/a.ts:3:5: error: fake violation');\nprocess.exit(1);\n");
  const fail = await runHandler('run_linter', {}, {WEKYT_PROJECT_ROOT: failDir});
  expectErr(fail, 'LINT_FAILED');
  fs.rmSync(passDir, {recursive: true, force: true});
  fs.rmSync(failDir, {recursive: true, force: true});
});

test('run_checker parses findings and reports pass and fail', async () => {
  const passDir = runnerFixture({check: 'node check.mjs'});
  fs.writeFileSync(path.join(passDir, 'check.mjs'), "console.log('src/b.ts:10: warning: something');\n");
  const pass = expectOk(await runHandler('run_checker', {}, {WEKYT_PROJECT_ROOT: passDir}));
  assert.equal(pass.passed, true);
  assert.deepEqual(pass.findings, [
    {file: 'src/b.ts', line: 10, check: 'typecheck', message: 'warning: something', severity: 'blocking'},
  ]);

  const failDir = runnerFixture({check: 'node check.mjs'});
  fs.writeFileSync(path.join(failDir, 'check.mjs'), "console.log('src/b.ts:10: warning: something');\nprocess.exit(1);\n");
  const fail = await runHandler('run_checker', {checks: ['typecheck']}, {WEKYT_PROJECT_ROOT: failDir});
  expectErr(fail, 'CHECK_FAILED');
  fs.rmSync(passDir, {recursive: true, force: true});
  fs.rmSync(failDir, {recursive: true, force: true});
});

test('run_build runs npm run build and reports pass, fail and missing script', async () => {
  const passDir = runnerFixture({build: "node -e \"process.exit(0)\""});
  const pass = expectOk(await runHandler('run_build', {}, {WEKYT_PROJECT_ROOT: passDir}));
  assert.equal(pass.passed, true);
  assert.equal(pass.exitCode, 0);
  assert.equal(typeof pass.stdout, 'string');
  assert.equal(typeof pass.stderr, 'string');
  assert.equal(pass.command, 'npm run build');

  const failDir = runnerFixture({build: "node -e \"process.exit(1)\""});
  expectErr(await runHandler('run_build', {}, {WEKYT_PROJECT_ROOT: failDir}), 'BUILD_FAILED');

  const noBuildDir = runnerFixture({});
  expectErr(await runHandler('run_build', {}, {WEKYT_PROJECT_ROOT: noBuildDir}), 'TOOL_NOT_CONFIGURED');
  fs.rmSync(passDir, {recursive: true, force: true});
  fs.rmSync(failDir, {recursive: true, force: true});
  fs.rmSync(noBuildDir, {recursive: true, force: true});
});

// git_branch, git_commit, git_push

test('git_branch creates a branch and refuses an existing branch and a missing base', async () => {
  const dir = gitRepo();
  const env = {WEKYT_PROJECT_ROOT: dir};
  const out = expectOk(await runHandler('git_branch', {name: 'feature-x', base: 'main'}, env));
  assert.equal(out.branch, 'feature-x');
  assert.equal(out.base, 'main');
  assert.equal(git(dir, 'branch', '--show-current').trim(), 'feature-x');
  expectErr(await runHandler('git_branch', {name: 'feature-x', base: 'main'}, env), 'BRANCH_EXISTS');
  expectErr(await runHandler('git_branch', {name: 'feature-y', base: 'nope'}, env), 'BASE_NOT_FOUND');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('git_commit commits staged changes and refuses main, empty and pushed amend', async () => {
  const dir = gitRepo();
  git(dir, 'checkout', '-b', 'feature-x');
  fs.writeFileSync(path.join(dir, 'code.txt'), 'v1\n');
  git(dir, 'add', '.');
  const env = {WEKYT_PROJECT_ROOT: dir, ...GIT_ENV};
  const out = expectOk(await runHandler('git_commit', {message: 'add code'}, env));
  assert.match(out.commit, /^[0-9a-f]{40}$/);
  assert.match(git(dir, 'log', '--oneline'), /add code/);
  expectErr(await runHandler('git_commit', {message: 'nothing'}, env), 'NOTHING_TO_COMMIT');

  git(dir, 'checkout', 'main');
  fs.writeFileSync(path.join(dir, 'main.txt'), 'm\n');
  git(dir, 'add', '.');
  expectErr(await runHandler('git_commit', {message: 'on main'}, env), 'ON_MAIN_BRANCH');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('git_push refuses main and pushes a feature branch to a local remote', async () => {
  const dir = gitRepo();
  const bare = tmpDir();
  git(bare, 'init', '--bare');
  git(dir, 'remote', 'add', 'origin', bare);
  const env = {WEKYT_PROJECT_ROOT: dir};
  expectErr(await runHandler('git_push', {remote: 'origin', branch: 'main'}, env), 'PUSH_TO_MAIN');
  git(dir, 'checkout', '-b', 'feature-x');
  const out = expectOk(await runHandler('git_push', {remote: 'origin', branch: 'feature-x'}, env));
  assert.equal(out.pushed, true);
  assert.equal(out.branch, 'feature-x');
  assert.match(git(bare, 'branch'), /feature-x/);
  fs.rmSync(dir, {recursive: true, force: true});
  fs.rmSync(bare, {recursive: true, force: true});
});

// rollback

test('rollback refuses a non-main branch and reverts a commit on main', async () => {
  const dir = gitRepo();
  git(dir, 'checkout', '-b', 'feature-x');
  let env = {WEKYT_PROJECT_ROOT: dir, ...GIT_ENV};
  expectErr(await runHandler('rollback', {commit: 'HEAD', reason: 'bad commit'}, env), 'NOT_ON_MAIN');
  git(dir, 'checkout', 'main');
  fs.writeFileSync(path.join(dir, 'second.txt'), 's\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-m', 'second commit');
  const sha = git(dir, 'rev-parse', 'HEAD').trim();
  env = {WEKYT_PROJECT_ROOT: dir, ...GIT_ENV};
  const out = expectOk(await runHandler('rollback', {commit: sha, reason: 'second commit broke the build'}, env));
  assert.match(out.revertCommit, /^[0-9a-f]{40}$/);
  assert.equal(fs.existsSync(path.join(dir, 'second.txt')), false);
  assert.match(git(dir, 'log', '--oneline'), /Revert "second commit"/);
  fs.rmSync(dir, {recursive: true, force: true});
});

// audit_log

test('audit_log appends a JSON entry and refuses the judge role', async () => {
  const dir = tmpDir();
  const env = {WEKYT_PROJECT_ROOT: dir};
  const out = expectOk(await runHandler('audit_log', {
    taskId: 't1', actor: 'qa', action: 'approval', evidence: 'tests green', details: 'ok',
  }, env));
  assert.equal(out.path, 'ai/audit.log');
  assert.ok(out.bytes > 0);
  const lines = fs.readFileSync(path.join(dir, 'ai', 'audit.log'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 1);
  const entry = JSON.parse(lines[0]);
  assert.equal(entry.taskId, 't1');
  assert.equal(entry.action, 'approval');
  assert.equal(typeof entry.timestamp, 'string');
  expectErr(await runHandler('audit_log', {
    taskId: 't1', actor: 'judge', action: 'approval', evidence: 'x', details: 'y', _role: 'judge',
  }, env), 'PERMISSION_DENIED');
  expectErr(await runHandler('audit_log', {
    taskId: 't1', actor: 'qa', action: 'explode', evidence: 'x', details: 'y',
  }, env), 'INVALID_ACTION');
  fs.rmSync(dir, {recursive: true, force: true});
});

// open_pull_request and merge_pull_request against a local stub server

function githubStub() {
  let posts = 0;
  let existing = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const send = (code, obj) => {
        res.writeHead(code, {'content-type': 'application/json'});
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'GET' && req.url.startsWith('/repos/o/r/pulls?')) {
        send(200, existing ? [existing] : []);
      } else if (req.method === 'GET' && req.url === '/repos/o/r/pulls/7') {
        send(200, {number: 7, state: 'open', title: 'feat'});
      } else if (req.method === 'POST' && req.url === '/repos/o/r/pulls') {
        posts += 1;
        const input = JSON.parse(body);
        send(201, {number: 7, state: 'open', title: input.title, html_url: 'https://github.com/o/r/pull/7'});
      } else if (req.method === 'PUT' && req.url === '/repos/o/r/pulls/7/merge') {
        send(200, {merged: true, sha: 'abc123', message: 'Pull Request successfully merged'});
      } else {
        send(404, {message: 'not found'});
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({server, port, getPosts: () => posts, setExisting: (pr) => { existing = pr; }});
    });
  });
}

function githubFixture(stub) {
  const dir = gitRepo();
  git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  return {
    dir,
    env: {
      WEKYT_PROJECT_ROOT: dir,
      GITHUB_TOKEN: 'test-token',
      WEKYT_GITHUB_API_URL: `http://127.0.0.1:${stub.port}`,
    },
  };
}

test('open_pull_request creates a PR and returns the existing one on a second call', async (t) => {
  const stub = await githubStub();
  t.after(() => { stub.server.closeAllConnections(); stub.server.close(); });
  const {dir, env} = githubFixture(stub);
  const input = {title: 'feat', body: 'body', head: 'feature-x', base: 'main'};
  const created = expectOk(await runHandler('open_pull_request', input, env));
  assert.equal(created.number, 7);
  assert.equal(created.url, 'https://github.com/o/r/pull/7');
  assert.equal(stub.getPosts(), 1);
  stub.setExisting({number: 7, state: 'open', title: 'feat', html_url: 'https://github.com/o/r/pull/7'});
  const again = expectOk(await runHandler('open_pull_request', input, env));
  assert.equal(again.number, 7);
  assert.equal(stub.getPosts(), 1);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('open_pull_request without credentials returns NOT_AUTHENTICATED', async () => {
  const dir = gitRepo();
  git(dir, 'remote', 'add', 'origin', 'https://github.com/o/r.git');
  const env = {WEKYT_PROJECT_ROOT: dir, GITHUB_TOKEN: ''};
  const res = await runHandler('open_pull_request', {title: 't', body: 'b', head: 'h', base: 'main'}, env);
  expectErr(res, 'NOT_AUTHENTICATED');
  fs.rmSync(dir, {recursive: true, force: true});
});

test('merge_pull_request enforces layers, audit entry, and merges through the stub', async (t) => {
  const stub = await githubStub();
  t.after(() => { stub.server.closeAllConnections(); stub.server.close(); });
  const {dir, env} = githubFixture(stub);
  expectErr(await runHandler('merge_pull_request', {number: 7}, env), 'LAYERS_NOT_AGREED');
  expectErr(await runHandler('merge_pull_request', {
    number: 7,
    agreement: {architect: true, dev: true, qa: true, qaTestsGreen: true, security: true},
  }, env), 'NO_AUDIT_ENTRY');
  expectOk(await runHandler('audit_log', {
    taskId: 't1', actor: 'judge', action: 'merge', evidence: 'all layers agreed', details: 'Layers agreed for pull request #7',
  }, env));
  const out = expectOk(await runHandler('merge_pull_request', {
    number: 7,
    agreement: {architect: true, dev: true, qa: true, qaTestsGreen: true, security: true},
  }, env));
  assert.equal(out.merged, true);
  assert.equal(out.number, 7);
  expectErr(await runHandler('merge_pull_request', {
    number: 7, _role: 'dev',
    agreement: {architect: true, dev: true, qa: true, qaTestsGreen: true, security: true},
  }, env), 'PERMISSION_DENIED');
  fs.rmSync(dir, {recursive: true, force: true});
});

// web_search

test('web_search returns NOT_IMPLEMENTED when the provider is none', async () => {
  const res = await runHandler('web_search', {query: 'Ink 8'}, {WEKYT_WEB_SEARCH_PROVIDER: 'none'});
  expectErr(res, 'NOT_IMPLEMENTED');
});

test('web_search returns results from a stub DuckDuckGo server', async (t) => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, {'content-type': 'application/json'});
    res.end(JSON.stringify({
      AbstractText: 'Ink is a React renderer for CLIs.',
      AbstractURL: 'https://example.com/ink',
      RelatedTopics: [
        {Text: 'Ink 8 release notes', FirstURL: 'https://example.com/ink8'},
        {Name: 'Group', Topics: [{Text: 'Nested topic', FirstURL: 'https://example.com/nested'}]},
      ],
    }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const out = expectOk(await runHandler('web_search', {query: 'Ink 8', maxResults: 5}, {
    WEKYT_DDG_API_URL: `http://127.0.0.1:${port}`,
  }));
  assert.equal(out.query, 'Ink 8');
  assert.ok(out.results.length >= 2);
  assert.equal(out.results[0].url, 'https://example.com/ink');
  assert.match(out.results[0].snippet, /Ink is a React renderer/);
});

// fetch_url

test('fetch_url reads text, and refuses errors, binary and bad URLs', async (t) => {
  const server = http.createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, {'content-type': 'text/plain'});
      res.end('hello fetch\n');
    } else if (req.url === '/bin') {
      res.writeHead(200, {'content-type': 'application/octet-stream'});
      res.end(Buffer.from([0x00, 0x01]));
    } else {
      res.writeHead(404, {'content-type': 'text/plain'});
      res.end('missing\n');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const port = server.address().port;
  const out = expectOk(await runHandler('fetch_url', {url: `http://127.0.0.1:${port}/ok`}, {}));
  assert.equal(out.status, 200);
  assert.equal(out.content, 'hello fetch\n');
  assert.equal(out.truncated, false);
  expectErr(await runHandler('fetch_url', {url: `http://127.0.0.1:${port}/missing`}, {}), 'FETCH_FAILED');
  expectErr(await runHandler('fetch_url', {url: `http://127.0.0.1:${port}/bin`}, {}), 'UNSUPPORTED_CONTENT_TYPE');
  expectErr(await runHandler('fetch_url', {url: 'ftp://example.com/x'}, {}), 'INVALID_URL');
  expectErr(await runHandler('fetch_url', {url: 'https://user:pass@example.com/x'}, {}), 'INVALID_URL');
});

// every handler refuses the judge role

test('every handler refuses the judge role', async () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const env = {WEKYT_PROJECT_ROOT: dir, WEKYT_ROLE: 'judge'};
  const inputs = {
    read_file: {path: 'a.txt'},
    write_file: {path: 'b.txt', content: 'x', mode: 'create'},
    edit_file: {path: 'a.txt', oldText: 'x', newText: 'y'},
    list_files: {pattern: '**/*'},
    search_code: {query: 'x'},
    run_tests: {},
    run_linter: {},
    run_checker: {},
    run_build: {},
    web_search: {query: 'x'},
    fetch_url: {url: 'https://example.com'},
    git_branch: {name: 'b', base: 'main'},
    git_commit: {message: 'm'},
    git_push: {remote: 'origin', branch: 'b'},
    open_pull_request: {title: 't', body: 'b', head: 'h', base: 'main'},
    merge_pull_request: {number: 1},
    rollback: {commit: 'HEAD'},
    audit_log: {taskId: 't', actor: 'judge', action: 'approval', evidence: 'e', details: 'd'},
  };
  for (const [id, input] of Object.entries(inputs)) {
    const res = await runHandler(id, input, env);
    assert.equal(res.out.ok, false, `${id} must refuse judge, got: ${res.stdout}`);
    assert.equal(res.out.error.code, 'PERMISSION_DENIED', `${id} must return PERMISSION_DENIED, got: ${res.stdout}`);
  }
  fs.rmSync(dir, {recursive: true, force: true});
});

// Windows spawn: bare names that exist only as .cmd shims (npm, pnpm)
// must resolve on PATH and run through a shell. Regression test for the
// 0.4.0 publish failure (workflow run #10): spawnSync npm ENOENT.

function withPathDir(dir, fn) {
  const saved = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${saved}`;
  try {
    return fn();
  } finally {
    process.env.PATH = saved;
  }
}

function writeShim(dir, name) {
  const file = path.join(dir, `${name}.cmd`);
  if (process.platform === 'win32') {
    fs.writeFileSync(file, '@echo hello-from-shim\r\n');
  } else {
    fs.writeFileSync(file, '#!/bin/sh\necho hello-from-shim\n');
    fs.chmodSync(file, 0o755);
  }
  return file;
}

test('resolveCommand finds .cmd shims on PATH and returns null when absent', async () => {
  const dir = tmpDir();
  const shim = writeShim(dir, 'fakecmd');
  const found = withPathDir(dir, () => resolveCommand('fakecmd'));
  assert.equal(found, shim);
  assert.ok(found.endsWith('.cmd'), `resolved path must keep the found suffix: ${found}`);
  assert.ok(fs.statSync(found).isFile(), 'resolved path must be an existing file');
  assert.equal(resolveCommand('no-such-command-wekyt-xyz'), null);
  assert.equal(resolveCommand('no-such-command-wekyt-xyz', 'win32'), null);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('resolveCommand prefers executable suffixes over a bare file on win32', async () => {
  // Regression test for the 0.4.0 publish failure (workflow run #11):
  // the Windows Node distribution ships an extensionless `npm` shell
  // script next to npm.cmd, and the resolver returned the bare file,
  // which Windows cannot run (spawnSync ...\npm ENOENT). On win32 the
  // .cmd shim must win; on POSIX the bare file is the norm and stays first.
  assert.deepEqual(commandSuffixes('win32'), ['.exe', '.bat', '.cmd', '']);
  assert.deepEqual(commandSuffixes('linux'), ['', '.exe', '.cmd']);
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'npm'), '#!/bin/sh\necho should-not-run\n');
  const shim = writeShim(dir, 'npm');
  // The win32 branch splits PATH on ';', so the fixture dir must be
  // joined with ';' for that call and with the native delimiter for the
  // POSIX call; a ':'-joined PATH is one single entry to the win32 branch.
  const saved = process.env.PATH;
  try {
    process.env.PATH = `${dir};${saved}`;
    const win32 = resolveCommand('npm', 'win32');
    assert.equal(win32, shim);
    assert.ok(win32.endsWith('.cmd'), `win32 must resolve to the shim: ${win32}`);
    assert.equal(resolveCommand('no-such-command-wekyt-xyz', 'win32'), null);
    process.env.PATH = `${dir}${path.delimiter}${saved}`;
    const posix = resolveCommand('npm', 'linux');
    assert.equal(posix, path.join(dir, 'npm'));
    const current = resolveCommand('npm');
    if (process.platform === 'win32') assert.equal(current, shim);
    else assert.equal(current, path.join(dir, 'npm'));
  } finally {
    process.env.PATH = saved;
    fs.rmSync(dir, {recursive: true, force: true});
  }
});

test('runCommand runs the .cmd shim when a bare file shadows it on win32', async () => {
  // Same shadowed-shim fixture as above, through the real spawn path.
  // On win32 the .cmd shim must run; elsewhere the bare file is the
  // native executable form and runs instead.
  const dir = tmpDir();
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(dir, 'toolname'), '#!/bin/sh\necho wrong-file\n');
    fs.writeFileSync(path.join(dir, 'toolname.cmd'), '@echo hello-from-shim\r\n');
  } else {
    fs.writeFileSync(path.join(dir, 'toolname'), '#!/bin/sh\necho wrong-file\n');
    fs.chmodSync(path.join(dir, 'toolname'), 0o755);
    fs.writeFileSync(path.join(dir, 'toolname.cmd'), '#!/bin/sh\necho hello-from-shim\n');
    fs.chmodSync(path.join(dir, 'toolname.cmd'), 0o755);
  }
  const result = withPathDir(dir, () => runCommand(['toolname'], {timeoutMs: 10000}));
  assert.equal(result.code, 0);
  if (process.platform === 'win32') assert.match(result.stdout, /hello-from-shim/);
  else assert.match(result.stdout, /wrong-file/);
  fs.rmSync(dir, {recursive: true, force: true});
});

test('shellOptionFor in handlers requires a shell for .cmd/.bat files on win32', () => {
  assert.deepEqual(shellOptionFor('C:\\tools\\npm.cmd', 'win32'), {shell: true});
  assert.deepEqual(shellOptionFor('C:\\tools\\tool.BAT', 'win32'), {shell: true});
  assert.deepEqual(shellOptionFor('C:\\tools\\tool.exe', 'win32'), {});
  assert.deepEqual(shellOptionFor('C:\\tools\\tool', 'win32'), {});
  assert.deepEqual(shellOptionFor('/usr/bin/npm.cmd', 'linux'), {});
  assert.deepEqual(shellOptionFor('/usr/bin/npm', 'linux'), {});
});

test('runCommand runs a command that exists only as a .cmd shim', async () => {
  const dir = tmpDir();
  writeShim(dir, 'shimname');
  const result = withPathDir(dir, () => runCommand(['shimname'], {timeoutMs: 10000}));
  assert.equal(result.code, 0);
  assert.match(result.stdout, /hello-from-shim/);
  assert.throws(
    () => runCommand(['no-such-command-wekyt-xyz'], {timeoutMs: 5000}),
    (e) => e.code === 'INTERNAL_ERROR' && /Cannot run no-such-command-wekyt-xyz: spawnSync no-such-command-wekyt-xyz ENOENT/.test(e.message),
  );
  fs.rmSync(dir, {recursive: true, force: true});
});

function realNpmPath() {
  // The real npm next to the running node binary on Windows, `which npm`
  // elsewhere. Never the fixture binDir: the caller prepends that dir to
  // PATH only in the handler environment.
  if (process.platform === 'win32') {
    const nextToNode = path.join(path.dirname(process.execPath), 'npm.cmd');
    if (fs.existsSync(nextToNode)) return nextToNode;
    return execFileSync('where', ['npm.cmd'], {encoding: 'utf8'}).trim().split(/\r?\n/)[0];
  }
  return execFileSync('which', ['npm'], {encoding: 'utf8'}).trim();
}

test('run_tests runs when npm exists only as an npm.cmd shim', async () => {
  // Regression test for the 0.4.0 publish failure (workflow run #11):
  // the Windows Node distribution ships an extensionless `npm` shell
  // script next to npm.cmd, and the resolver must pick the shim. The
  // fixture binDir replicates that: a bare `npm` file plus an npm.cmd
  // delegating to the real npm. On win32 the bare file is junk text,
  // like the real toolcache file; elsewhere it must also delegate,
  // because POSIX resolution returns the bare file first.
  const realNpm = realNpmPath();
  assert.ok(realNpm, 'npm must be on PATH for this test');
  const binDir = tmpDir();
  if (process.platform === 'win32') {
    fs.writeFileSync(path.join(binDir, 'npm'), '#!/bin/sh\necho should-not-run\n');
    fs.writeFileSync(path.join(binDir, 'npm.cmd'), `@echo off\r\ncall "${realNpm}" %*\r\nexit /b %errorlevel%\r\n`);
  } else {
    fs.writeFileSync(path.join(binDir, 'npm'), `#!/bin/sh\nexec ${realNpm} "$@"\n`);
    fs.chmodSync(path.join(binDir, 'npm'), 0o755);
    fs.writeFileSync(path.join(binDir, 'npm.cmd'), `#!/bin/sh\nexec ${realNpm} "$@"\n`);
    fs.chmodSync(path.join(binDir, 'npm.cmd'), 0o755);
  }
  const dir = runnerFixture({test: 'node test/a.test.mjs'});
  fs.mkdirSync(path.join(dir, 'test'));
  fs.writeFileSync(path.join(dir, 'test', 'a.test.mjs'), "import {test} from 'node:test';\ntest('ok', () => {});\n");
  const res = await runHandler('run_tests', {}, {
    WEKYT_PROJECT_ROOT: dir,
    PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
  });
  const out = expectOk(res);
  assert.equal(out.passed, true);
  fs.rmSync(binDir, {recursive: true, force: true});
  fs.rmSync(dir, {recursive: true, force: true});
});
