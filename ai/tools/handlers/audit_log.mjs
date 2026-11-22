#!/usr/bin/env node
// audit_log: append one audit entry to ai/audit.log. The log is append only:
// no agent can edit or delete an entry. Contract: ai/tools/audit_log.yaml
import * as fs from 'node:fs';
import * as path from 'node:path';
import {ToolError, checkInput, enforceRole, main, projectRoot} from './_lib.mjs';

export const TOOL_ID = 'audit_log';
export const ALLOWED_ROLES = ['orchestrator', 'architect', 'dev', 'qa', 'security'];
export const TIMEOUT_SECONDS = 10;
export const UNDERLYING_COMMAND = 'node:fs appendFileSync';

const INPUT = {
  type: 'object',
  properties: {
    taskId: {type: 'string', minLength: 1},
    actor: {type: 'string', enum: ['orchestrator', 'architect', 'dev', 'qa', 'security', 'judge']},
    action: {type: 'string', enum: ['decision', 'delegation', 'approval', 'rejection', 'merge', 'rollback']},
    evidence: {type: 'string', minLength: 1},
    details: {type: 'string'},
  },
  required: ['taskId', 'actor', 'action', 'evidence'],
  additionalProperties: false,
};

await main(async (input, role) => {
  enforceRole(role, ALLOWED_ROLES);
  if (typeof input.action === 'string' && !INPUT.properties.action.enum.includes(input.action)) {
    throw new ToolError('INVALID_ACTION', 'Invalid audit action. Use decision, delegation, approval, rejection, merge, or rollback.');
  }
  checkInput(input, INPUT);
  const root = projectRoot();
  const aiDir = path.join(root, 'ai');
  try {
    fs.mkdirSync(aiDir, {recursive: true});
  } catch {
    throw new ToolError('LOG_WRITE_FAILED', 'Could not write the audit log. Check that ai/ exists and is writable, then try again.', true);
  }
  const line = JSON.stringify({
    taskId: input.taskId,
    actor: input.actor,
    action: input.action,
    evidence: input.evidence,
    details: input.details || '',
    timestamp: new Date().toISOString(),
  }) + '\n';
  try {
    fs.appendFileSync(path.join(aiDir, 'audit.log'), line, 'utf8');
  } catch {
    throw new ToolError('LOG_WRITE_FAILED', 'Could not write the audit log. Check that ai/ exists and is writable, then try again.', true);
  }
  return {path: 'ai/audit.log', bytes: Buffer.byteLength(line, 'utf8')};
});
