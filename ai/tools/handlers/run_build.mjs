#!/usr/bin/env node
// run_build: run the project build and return pass or fail with output.
// The command is the one declared in package.json scripts.build.
// Contract: ai/tools/run_build.yaml
import {ToolError, checkInput, enforceRole, main, projectRoot, readPackageJson, runCommand} from './_lib.mjs';

export const TOOL_ID = 'run_build';
export const ALLOWED_ROLES = ['dev', 'qa'];
export const TIMEOUT_SECONDS = 600;
export const UNDERLYING_COMMAND = ['npm', 'run', 'build'];

const INPUT = {
  type: 'object',
  properties: {
    args: {type: 'array', items: {type: 'string'}},
    timeoutSeconds: {type: 'integer', minimum: 10, maximum: 1800, default: 600},
  },
  additionalProperties: false,
};

const OUTPUT_CAP = 100000;

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const pkg = readPackageJson(root);
  if (!pkg || !pkg.scripts || typeof pkg.scripts.build !== 'string') {
    throw new ToolError('TOOL_NOT_CONFIGURED', 'No build command configured. Add scripts.build to package.json, or declare the build in the architecture.');
  }
  const argv = ['npm', 'run', 'build'];
  if (Array.isArray(input.args)) argv.push(...input.args);
  const command = argv.join(' ');
  const result = runCommand(argv, {cwd: root, timeoutMs: input.timeoutSeconds * 1000});
  if (result.timedOut) {
    throw new ToolError('BUILD_TIMEOUT', 'Build timed out. Raise timeoutSeconds.', true);
  }
  const stdout = result.stdout.slice(0, OUTPUT_CAP);
  const stderr = result.stderr.slice(0, OUTPUT_CAP);
  if (result.code !== 0) {
    const tail = (stdout + stderr).trim().slice(-1000);
    throw new ToolError('BUILD_FAILED', `Build failed. ${tail}`);
  }
  return {passed: true, exitCode: result.code, stdout, stderr, command};
});
