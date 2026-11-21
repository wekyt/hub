// Validate the tool definitions in ai/tools/*.yaml and, with --generate,
// regenerate ai/tools/tools.json and the matrix in ai/tools/permissions.md
// from the same YAML files. The YAML files are the source of truth.
// Usage: node scripts/validate-tools.mjs [--generate]
import * as fs from 'node:fs';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as YAML from 'yaml';

const root = path.dirname(fileURLToPath(import.meta.url));
const cliDir = path.resolve(root, '..');
// WEKYT_HUB_DIR overrides the hub root, for tests on a copied tree.
const hubDir = process.env.WEKYT_HUB_DIR ? path.resolve(process.env.WEKYT_HUB_DIR) : path.resolve(cliDir, '..');
const toolsDir = path.join(hubDir, 'ai', 'tools');
const agentsDir = path.join(hubDir, 'ai', 'agents');

const ROLES = ['orchestrator', 'architect', 'dev', 'qa', 'security', 'judge'];
const KINDS = ['read', 'write', 'search', 'test', 'git', 'safety'];
const TOOLSETS = ['read', 'write', 'git', 'test', 'safety'];
const IMPL_KINDS = ['api', 'command', 'script', 'mcp_passthrough'];
const TOOL_ORDER = [
  'read_file', 'write_file', 'search_code', 'run_tests', 'run_linter', 'run_checker',
  'web_search', 'git_branch', 'git_commit', 'git_push', 'open_pull_request',
  'merge_pull_request', 'rollback', 'audit_log',
];

const errors = [];
const notes = [];
function fail(msg) {
  errors.push(msg);
}
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function isSemver(v) {
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
}
function checkSchema(schema, where) {
  if (!isPlainObject(schema)) return fail(`${where}: schema must be an object`);
  if (schema.$schema && schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    fail(`${where}: $schema must be the JSON Schema 2020-12 URI`);
  }
  if (schema.type !== 'object') fail(`${where}: schema type must be object`);
  if (!isPlainObject(schema.properties)) fail(`${where}: schema needs properties`);
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) fail(`${where}: required must be an array`);
    else for (const r of schema.required) {
      if (!schema.properties || !(r in schema.properties)) fail(`${where}: required field ${r} is not in properties`);
    }
  }
}

function readFrontmatterTools() {
  const out = {};
  for (const file of fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
    const text = fs.readFileSync(path.join(agentsDir, file), 'utf8');
    const nameMatch = text.match(/^name:\s*(\S+)/m);
    const toolsMatch = text.match(/^tools:\n((?:  - \S+\n)+)/m);
    if (!nameMatch || !toolsMatch) {
      fail(`agents/${file}: cannot read frontmatter name and tools list`);
      continue;
    }
    out[nameMatch[1]] = toolsMatch[1].split('\n').filter(Boolean).map((l) => l.replace(/^  - /, '').trim());
  }
  return out;
}

function validateTool(doc, fileName) {
  const where = fileName;
  const id = doc.name;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(id)) {
    fail(`${where}: name must match the MCP rule, 1 to 128 chars, ASCII letters, digits, _ - .`);
    return null;
  }
  if (!isSemver(doc.version)) fail(`${where}: version must be SemVer`);
  if (typeof doc.title !== 'string' || !doc.title) fail(`${where}: title is required`);
  if (!KINDS.includes(doc.kind)) fail(`${where}: kind must be one of ${KINDS.join(', ')}`);
  if (!TOOLSETS.includes(doc.toolset)) fail(`${where}: toolset must be one of ${TOOLSETS.join(', ')}`);
  if (typeof doc.description !== 'string' || doc.description.length < 120) {
    fail(`${where}: description must be at least 120 chars, 3 or 4 sentences`);
  } else if ((doc.description.match(/\./g) || []).length < 2) {
    fail(`${where}: description must be 3 or 4 sentences`);
  }
  if (!isPlainObject(doc.mcp)) return fail(`${where}: mcp is required`), null;
  checkSchema(doc.mcp.inputSchema, `${where}: mcp.inputSchema`);
  if (doc.mcp.outputSchema !== undefined) checkSchema(doc.mcp.outputSchema, `${where}: mcp.outputSchema`);
  const ann = doc.mcp.annotations;
  if (!isPlainObject(ann)) fail(`${where}: mcp.annotations is required`);
  if (typeof doc.outputs !== 'string' || !doc.outputs) fail(`${where}: outputs is required`);

  const impl = doc.implementation;
  if (!isPlainObject(impl)) fail(`${where}: implementation is required`);
  else {
    if (!IMPL_KINDS.includes(impl.kind)) fail(`${where}: implementation.kind must be one of ${IMPL_KINDS.join(', ')}`);
    if (typeof impl.timeoutSeconds !== 'number' || impl.timeoutSeconds <= 0) {
      fail(`${where}: implementation.timeoutSeconds must be a positive number`);
    }
    if (impl.implemented === false) {
      if (!impl.note || !/not implemented|no .* provider/i.test(impl.note)) {
        fail(`${where}: an unimplemented tool must say so in implementation.note and name no provider`);
      }
      if (impl.argv) fail(`${where}: an unimplemented tool must not declare argv, or it fakes an implementation`);
    } else if (impl.implemented === true) {
      if (impl.kind === 'command' && (!Array.isArray(impl.argv) || impl.argv.length === 0)) {
        fail(`${where}: a command implementation needs an exact argv`);
      }
      if (impl.kind === 'script' && typeof impl.handler !== 'string') {
        fail(`${where}: a script implementation needs a handler description`);
      }
      if (impl.kind === 'api' && (!impl.method || !impl.url)) {
        fail(`${where}: an api implementation needs method and url`);
      }
    } else {
      fail(`${where}: implementation.implemented must be true or false`);
    }
    if (impl.fallback) {
      if (impl.fallback.kind === 'command' && (!Array.isArray(impl.fallback.argv) || impl.fallback.argv.length === 0)) {
        fail(`${where}: fallback command needs an exact argv`);
      }
    }
  }

  const eff = doc.effects;
  if (!isPlainObject(eff)) fail(`${where}: effects is required`);
  else {
    for (const key of ['writes', 'deletes', 'externalCalls']) {
      if (!Array.isArray(eff[key])) fail(`${where}: effects.${key} must be an array`);
    }
    if (typeof eff.reversible !== 'boolean' || typeof eff.idempotent !== 'boolean') {
      fail(`${where}: effects.reversible and effects.idempotent must be booleans`);
    }
    if (ann && ann.readOnlyHint === true) {
      if (eff.writes.length || eff.deletes.length || eff.externalCalls.length) {
        fail(`${where}: contradiction: readOnlyHint is true but effects list writes, deletes or external calls`);
      }
      if (ann.destructiveHint === true) fail(`${where}: contradiction: readOnlyHint true with destructiveHint true`);
    }
    if (ann && typeof ann.idempotentHint === 'boolean' && ann.idempotentHint !== eff.idempotent) {
      fail(`${where}: contradiction: annotations.idempotentHint (${ann.idempotentHint}) disagrees with effects.idempotent (${eff.idempotent})`);
    }
  }

  if (!isPlainObject(doc.permissions)) fail(`${where}: permissions is required`);
  else {
    for (const role of ROLES) {
      const p = doc.permissions[role];
      if (!isPlainObject(p) || (p.decision !== 'allow' && p.decision !== 'deny')) {
        fail(`${where}: permissions.${role} must be {decision: allow|deny}`);
      }
    }
    for (const role of Object.keys(doc.permissions)) {
      if (!ROLES.includes(role)) fail(`${where}: permissions has unknown role ${role}`);
    }
    if (doc.permissions.judge.decision !== 'deny') {
      fail(`${where}: permissions.judge must be deny, the judge is a decision step, not a tool user`);
    }
  }

  if (!Array.isArray(doc.errors) || doc.errors.length === 0) fail(`${where}: errors must be a non-empty list`);
  else {
    const codes = new Set();
    for (const e of doc.errors) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(e.code || '')) fail(`${where}: error code ${e.code} must be UPPER_SNAKE`);
      if (codes.has(e.code)) fail(`${where}: duplicate error code ${e.code}`);
      codes.add(e.code);
      if (typeof e.retryable !== 'boolean') fail(`${where}: error ${e.code} needs retryable as a boolean`);
      if (!e.when || !e.message) fail(`${where}: error ${e.code} needs when and message`);
    }
  }
  if (!Array.isArray(doc.examples) || doc.examples.length === 0) fail(`${where}: examples must be a non-empty list`);
  else {
    for (const ex of doc.examples) {
      if (!ex.description || !isPlainObject(ex.input)) fail(`${where}: each example needs description and input`);
      if (!('output' in ex) && !('error' in ex)) fail(`${where}: each example needs output or error`);
    }
  }
  return doc;
}

const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith('.yaml')).sort();
const tools = [];
for (const file of files) {
  let doc;
  try {
    doc = YAML.parse(fs.readFileSync(path.join(toolsDir, file), 'utf8'));
  } catch (e) {
    fail(`${file}: invalid YAML: ${e.message}`);
    continue;
  }
  const valid = validateTool(doc, file);
  if (valid) tools.push(valid);
}

const ids = tools.map((t) => t.name);
for (const expected of TOOL_ORDER) {
  if (!ids.includes(expected)) fail(`missing tool definition: ${expected}.yaml`);
}
for (const id of ids) {
  if (!TOOL_ORDER.includes(id)) fail(`unexpected tool definition: ${id}.yaml`);
}
if (new Set(ids).size !== ids.length) fail('duplicate tool ids');

// Permissions must match the agent frontmatter lists.
const frontmatter = readFrontmatterTools();
for (const role of ['orchestrator', 'architect', 'dev', 'qa', 'security']) {
  const allowed = tools.filter((t) => t.permissions[role].decision === 'allow').map((t) => t.name).sort();
  const listed = [...(frontmatter[role] || [])].sort();
  if (JSON.stringify(allowed) !== JSON.stringify(listed)) {
    fail(`permissions mismatch for ${role}: YAML allows [${allowed.join(', ')}] but ai/agents/${role}.md lists [${listed.join(', ')}]`);
  }
}

if (errors.length > 0) {
  console.error(`tools validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

if (process.argv.includes('--generate')) {
  const ordered = [...tools].sort((a, b) => TOOL_ORDER.indexOf(a.name) - TOOL_ORDER.indexOf(b.name));
  const registry = {
    description: 'Tool registry for the wekyt hub. Generated from ai/tools/*.yaml, do not edit by hand. Agents discover tools by description. No tool belongs to an agent. Access is granted per role under least privilege in permissions.md.',
    tools: ordered.map((t) => ({
      description: t.description.replace(/\s+/g, ' ').trim(),
      id: t.name,
      kind: t.kind,
      name: t.title,
      toolset: t.toolset,
      version: t.version,
    })),
    version: 2,
  };
  fs.writeFileSync(path.join(toolsDir, 'tools.json'), JSON.stringify(registry, null, 2) + '\n');

  const permPath = path.join(toolsDir, 'permissions.md');
  const existing = fs.readFileSync(permPath, 'utf8');
  const hardRulesIndex = existing.indexOf('## Hard rules');
  const hardRules = hardRulesIndex >= 0 ? existing.slice(hardRulesIndex) : '';
  const header = '# Permissions\n\nLeast privilege by role. A tool listed in `tools.json` is available to the system, but no agent may use a tool that is not in its own frontmatter `tools` list. If a tool is not listed for a role, that role cannot use it, even when the tool exists in the registry. This matrix is generated from `ai/tools/*.yaml`, do not edit it by hand.\n\n## Matrix\n\n';
  const cols = ['Tool', 'Orchestrator', 'Architect', 'Dev', 'QA', 'Security'];
  const rows = ordered.map((t) => {
    const cell = (role) => {
      const p = t.permissions[role];
      if (p.decision !== 'allow') return 'no';
      if (!p.scope) return 'yes';
      const first = p.scope.split('.')[0].trim();
      return `yes, ${first.charAt(0).toLowerCase()}${first.slice(1)}`;
    };
    return `| ${t.name} | ${cell('orchestrator')} | ${cell('architect')} | ${cell('dev')} | ${cell('qa')} | ${cell('security')} |`;
  });
  const table = `| ${cols.join(' | ')} |\n| ${cols.map(() => '---').join(' | ')} |\n${rows.join('\n')}\n\n`;
  fs.writeFileSync(permPath, header + table + hardRules);
  console.log(`tools: validated ${tools.length} definitions, generated tools.json and permissions.md matrix.`);
} else {
  console.log(`tools: validated ${tools.length} definitions, no errors.`);
}
for (const n of notes) console.log(n);
