#!/usr/bin/env node
// write_file: create or overwrite a file in the project with text content.
// Contract: ai/tools/write_file.yaml
import * as fs from 'node:fs';
import * as path from 'node:path';
import {ToolError, checkInput, enforceRole, main, projectRoot, resolveInside} from './_lib.mjs';

export const TOOL_ID = 'write_file';
export const ALLOWED_ROLES = ['architect', 'dev'];
export const TIMEOUT_SECONDS = 30;
export const UNDERLYING_COMMAND = 'node:fs writeFileSync';

const INPUT = {
  type: 'object',
  properties: {
    path: {type: 'string'},
    content: {type: 'string'},
    mode: {type: 'string', enum: ['create', 'overwrite'], default: 'overwrite'},
  },
  required: ['path', 'content'],
  additionalProperties: false,
};

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  checkInput(input, INPUT);
  const root = projectRoot();
  const abs = resolveInside(root, input.path);
  const existed = fs.existsSync(abs);
  if (input.mode === 'create' && existed) {
    throw new ToolError('FILE_EXISTS', 'File already exists. Use mode overwrite, or pick another path.');
  }
  fs.mkdirSync(path.dirname(abs), {recursive: true});
  fs.writeFileSync(abs, input.content, 'utf8');
  return {path: input.path, bytes: Buffer.byteLength(input.content, 'utf8'), created: !existed};
});
