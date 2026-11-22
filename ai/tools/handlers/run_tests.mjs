#!/usr/bin/env node
// run_tests: run the project test suite and return pass or fail with output.
// The command is the one declared in package.json scripts.test.
// Contract: ai/tools/run_tests.yaml
import {ToolError, checkInput, enforceRole, main, parseTestCounts, projectRoot, readPackageJson, runCommand} from './_lib.mjs';

export const TOOL_ID = 'run_tests';
export const ALLOWED_ROLES = ['dev', 'qa'];
export const TIMEOUT_SECONDS = 600;
export const UNDERLYING_COMMAND = ['npm', 'test', '--'];

const INPUT = {
  type: 'object',
  properties: {
    testPath: {type: 'string'},
    filter: {type: 'string'},
    timeoutSeconds: {type: 'integer', minimum: 10, maximum: 3600, default: 600},
  },
  additionalProperties: false,
};

const OUTPUT_CAP = 100000;

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const pkg = readPackageJson(root);
  if (!pkg || !pkg.scripts || typeof pkg.scripts.test !== 'string') {
    throw new ToolError('TOOL_NOT_CONFIGURED', 'No test command configured. Add scripts.test to package.json, or declare another runner in the architecture.');
  }
  const argv = ['npm', 'test', '--'];
  if (input.testPath) argv.push(input.testPath);
  if (input.filter) argv.push(input.filter);
  const command = argv.join(' ');
  const started = Date.now();
  const result = runCommand(argv, {cwd: root, timeoutMs: input.timeoutSeconds * 1000});
  const durationMs = Date.now() - started;
  if (result.timedOut) {
    throw new ToolError('TEST_TIMEOUT', 'Tests timed out. Run a single test file, or raise timeoutSeconds.', true);
  }
  const output = (result.stdout + result.stderr).slice(0, OUTPUT_CAP);
  const counts = parseTestCounts(output);
  if (result.code !== 0) {
    const tail = output.trim().slice(-1000);
    throw new ToolError('TESTS_FAILED', `Tests failed (${counts.passedCount} passed, ${counts.failedCount} failed). ${tail}`);
  }
  return {passed: true, passedCount: counts.passedCount, failedCount: counts.failedCount, skippedCount: counts.skippedCount, durationMs, command, output};
});
