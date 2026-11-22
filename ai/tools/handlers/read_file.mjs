#!/usr/bin/env node
// read_file: read the contents of a file in the project and return it as text.
// Contract: ai/tools/read_file.yaml
import * as fs from 'node:fs';
import {ToolError, checkInput, enforceRole, isBinaryBuffer, main, projectRoot, resolveInside} from './_lib.mjs';

export const TOOL_ID = 'read_file';
export const ALLOWED_ROLES = ['orchestrator', 'architect', 'dev', 'qa', 'security'];
export const TIMEOUT_SECONDS = 30;
export const UNDERLYING_COMMAND = 'node:fs readFileSync';

const INPUT = {
  type: 'object',
  properties: {
    path: {type: 'string'},
    maxChars: {type: 'integer', minimum: 1, maximum: 1000000, default: 200000},
  },
  required: ['path'],
  additionalProperties: false,
};

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const abs = resolveInside(root, input.path);
  let buf;
  try {
    buf = fs.readFileSync(abs);
  } catch (e) {
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EISDIR') {
      throw new ToolError('FILE_NOT_FOUND', 'File not found. Check the path against the repo tree and try again.');
    }
    throw e;
  }
  if (isBinaryBuffer(buf)) {
    throw new ToolError('BINARY_FILE', 'File is binary. Read it with a tool that understands its format.');
  }
  const text = buf.toString('utf8');
  const truncated = text.length > input.maxChars;
  return {path: input.path, content: truncated ? text.slice(0, input.maxChars) : text, bytes: buf.length, truncated};
});
