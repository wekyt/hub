#!/usr/bin/env node
// edit_file: replace one exact piece of text inside a file, surgically.
// The old text must match exactly once, unless replaceAll is true.
// Contract: ai/tools/edit_file.yaml
import * as fs from 'node:fs';
import {ToolError, checkInput, enforceRole, isBinaryBuffer, main, projectRoot, resolveInside} from './_lib.mjs';

export const TOOL_ID = 'edit_file';
export const ALLOWED_ROLES = ['architect', 'dev'];
export const TIMEOUT_SECONDS = 30;
export const UNDERLYING_COMMAND = 'node:fs readFileSync+writeFileSync';

const INPUT = {
  type: 'object',
  properties: {
    path: {type: 'string'},
    oldText: {type: 'string', minLength: 1},
    newText: {type: 'string'},
    replaceAll: {type: 'boolean', default: false},
  },
  required: ['path', 'oldText', 'newText'],
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
    throw new ToolError('BINARY_FILE', 'File is binary. Edit it with a tool that understands its format.');
  }
  const text = buf.toString('utf8');
  const count = text.split(input.oldText).length - 1;
  if (count === 0) {
    throw new ToolError('TEXT_NOT_FOUND', 'The old text does not appear in the file. Check the exact text and try again.');
  }
  if (count > 1 && !input.replaceAll) {
    throw new ToolError('MULTIPLE_MATCHES', 'The old text matches more than once. Make it unique with more context, or set replaceAll to true.');
  }
  const next = input.replaceAll ? text.split(input.oldText).join(input.newText) : text.replace(input.oldText, input.newText);
  fs.writeFileSync(abs, next, 'utf8');
  return {path: input.path, replaced: count, matches: count};
});
