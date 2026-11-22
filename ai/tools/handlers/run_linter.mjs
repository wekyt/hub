#!/usr/bin/env node
// run_linter: run the project linter and return violations with file and line.
// The command is the one declared in package.json scripts.lint.
// Contract: ai/tools/run_linter.yaml
import {ToolError, checkInput, enforceRole, main, parseViolationLines, projectRoot, readPackageJson, runCommand} from './_lib.mjs';

export const TOOL_ID = 'run_linter';
export const ALLOWED_ROLES = ['dev', 'qa'];
export const TIMEOUT_SECONDS = 300;
export const UNDERLYING_COMMAND = ['npm', 'run', 'lint', '--'];

const INPUT = {
  type: 'object',
  properties: {
    path: {type: 'string'},
    timeoutSeconds: {type: 'integer', minimum: 10, maximum: 1800, default: 300},
  },
  additionalProperties: false,
};

const OUTPUT_CAP = 100000;

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const pkg = readPackageJson(root);
  if (!pkg || !pkg.scripts || typeof pkg.scripts.lint !== 'string') {
    throw new ToolError('TOOL_NOT_CONFIGURED', 'No linter configured. Add scripts.lint to package.json, or declare the linter in the architecture.');
  }
  const argv = ['npm', 'run', 'lint', '--'];
  if (input.path) argv.push(input.path);
  const command = argv.join(' ');
  const result = runCommand(argv, {cwd: root, timeoutMs: input.timeoutSeconds * 1000});
  if (result.timedOut) {
    throw new ToolError('LINT_TIMEOUT', 'Lint timed out. Lint a single directory, or raise timeoutSeconds.', true);
  }
  const output = (result.stdout + result.stderr).slice(0, OUTPUT_CAP);
  const violations = parseViolationLines(output);
  if (result.code !== 0) {
    const first = violations.slice(0, 3).map((v) => `${v.file}:${v.line} ${v.message}`).join(' | ');
    throw new ToolError('LINT_FAILED', `Lint failed with ${violations.length} violation(s). ${first}`);
  }
  return {passed: true, violations, command, output};
});
