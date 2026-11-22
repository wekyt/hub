#!/usr/bin/env node
// run_checker: run the static checker (type checks and security checks) and
// return findings with file and line. Resolution order: package.json
// scripts.check, then scripts.typecheck. Contract: ai/tools/run_checker.yaml
import {ToolError, checkInput, enforceRole, main, parseFindingLines, projectRoot, readPackageJson, runCommand} from './_lib.mjs';

export const TOOL_ID = 'run_checker';
export const ALLOWED_ROLES = ['dev', 'qa', 'security'];
export const TIMEOUT_SECONDS = 300;
export const UNDERLYING_COMMAND = ['npm', 'run', 'check', '--'];

const INPUT = {
  type: 'object',
  properties: {
    path: {type: 'string'},
    checks: {type: 'array', items: {type: 'string', enum: ['typecheck', 'security']}},
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
  const script = pkg && pkg.scripts && typeof pkg.scripts.check === 'string'
    ? 'check'
    : pkg && pkg.scripts && typeof pkg.scripts.typecheck === 'string' ? 'typecheck' : null;
  if (!script) {
    throw new ToolError('TOOL_NOT_CONFIGURED', 'No checker configured. Add scripts.check or scripts.typecheck to package.json, or declare the checker in the architecture.');
  }
  const argv = ['npm', 'run', script, '--'];
  if (input.path) argv.push(input.path);
  const command = argv.join(' ');
  const checkName = input.checks && input.checks.length === 1 && input.checks[0] === 'security' ? 'security' : 'typecheck';
  const result = runCommand(argv, {cwd: root, timeoutMs: input.timeoutSeconds * 1000});
  if (result.timedOut) {
    throw new ToolError('CHECK_TIMEOUT', 'Check timed out. Check a single directory, or raise timeoutSeconds.', true);
  }
  const output = (result.stdout + result.stderr).slice(0, OUTPUT_CAP);
  const findings = parseFindingLines(output, checkName);
  if (result.code !== 0) {
    const first = findings.slice(0, 3).map((f) => `${f.file}:${f.line} ${f.message}`).join(' | ');
    throw new ToolError('CHECK_FAILED', `Check failed with ${findings.length} finding(s). ${first}`);
  }
  return {passed: true, findings, command, output};
});
