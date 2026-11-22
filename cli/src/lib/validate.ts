// Validate a project team in ./ai/: tool definitions, permissions matrix,
// tools.json, user skills and the harness config. This is the same validator
// the dev script runs; cli/scripts/validate-tools.mjs calls into the bundled
// CLI so there is only one validator to keep correct.
import * as fs from 'node:fs';
import * as path from 'node:path';
import {execFileSync} from 'node:child_process';
import * as YAML from 'yaml';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  tools: number;
  skills: number;
}

type YamlDoc = Record<string, any>;

const ROLES = ['orchestrator', 'architect', 'dev', 'qa', 'security', 'judge'];
const MATRIX_ROLES = ['orchestrator', 'architect', 'dev', 'qa', 'security'];
const ROLE_COLUMNS: Record<string, string> = {
  Orchestrator: 'orchestrator',
  Architect: 'architect',
  Dev: 'dev',
  QA: 'qa',
  Security: 'security',
};
const KINDS = ['read', 'write', 'search', 'test', 'git', 'safety'];
const TOOLSETS = ['read', 'write', 'git', 'test', 'safety'];
const IMPL_KINDS = ['api', 'command', 'script', 'mcp_passthrough'];
const TOOL_ORDER = [
  'read_file', 'write_file', 'edit_file', 'list_files', 'search_code', 'run_tests', 'run_linter', 'run_checker',
  'run_build', 'web_search', 'fetch_url', 'git_branch', 'git_commit', 'git_push', 'open_pull_request',
  'merge_pull_request', 'rollback', 'audit_log',
];
const HARNESSES = ['claude', 'cursor', 'codex', 'gemini'];

function isPlainObject(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isSemver(v: unknown): boolean {
  return typeof v === 'string' && /^\d+\.\d+\.\d+$/.test(v);
}

class Checker {
  errors: string[] = [];
  fail(msg: string): void {
    this.errors.push(msg);
  }
}

function checkSchema(c: Checker, schema: any, where: string): void {
  if (!isPlainObject(schema)) return c.fail(`${where}: schema must be an object`);
  if (schema.$schema && schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    c.fail(`${where}: $schema must be the JSON Schema 2020-12 URI`);
  }
  if (schema.type !== 'object') c.fail(`${where}: schema type must be object`);
  if (!isPlainObject(schema.properties)) c.fail(`${where}: schema needs properties`);
  if (schema.required !== undefined) {
    if (!Array.isArray(schema.required)) c.fail(`${where}: required must be an array`);
    else {
      for (const r of schema.required) {
        if (!schema.properties || !(r in schema.properties)) c.fail(`${where}: required field ${r} is not in properties`);
      }
    }
  }
}

function extractStringLiteral(source: string, constName: string): string | null {
  const m = source.match(new RegExp(`const ${constName} = '([^']*)';`));
  return m ? m[1] : null;
}

function extractNumberLiteral(source: string, constName: string): number | null {
  const m = source.match(new RegExp(`const ${constName} = (\\d+);`));
  return m ? Number(m[1]) : null;
}

function extractArrayLiteral(source: string, constName: string): string[] | null {
  const m = source.match(new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\];`));
  if (!m) return null;
  return [...m[1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');
}

/**
 * A tool that claims implemented: true must ship a real handler, and the
 * handler must agree with the YAML on every contract point: file name,
 * invocation, tool id, allowed roles, timeout, underlying command, and
 * fallback command. A name alone proves nothing, so the check reads the
 * handler source instead of trusting the YAML.
 */
function checkHandler(c: Checker, doc: YamlDoc, fileName: string, toolsDir: string): void {
  const impl = doc.implementation;
  const where = fileName;
  const handler = impl.handler;
  if (typeof handler !== 'string' || !/^ai\/tools\/handlers\/[A-Za-z0-9_.-]+\.mjs$/.test(handler)) {
    c.fail(`${where}: implementation.handler must be a path ai/tools/handlers/<tool>.mjs`);
    return;
  }
  if (handler !== `ai/tools/handlers/${doc.name}.mjs`) {
    c.fail(`${where}: implementation.handler must be ai/tools/handlers/${doc.name}.mjs, got ${handler}`);
  }
  if (impl.invoke !== `node ${handler}`) {
    c.fail(`${where}: implementation.invoke must be \`node ${handler}\``);
  }
  const handlerPath = path.join(toolsDir, 'handlers', `${doc.name}.mjs`);
  if (!fs.existsSync(handlerPath)) {
    c.fail(`${where}: handler file missing: ${handler}`);
    return;
  }
  try {
    execFileSync(process.execPath, ['--check', handlerPath], {stdio: 'pipe'});
  } catch {
    c.fail(`${where}: handler ${handler} does not parse (node --check failed)`);
    return;
  }
  const source = fs.readFileSync(handlerPath, 'utf8');
  const toolId = extractStringLiteral(source, 'TOOL_ID');
  if (toolId !== doc.name) {
    c.fail(`${where}: handler TOOL_ID must be '${doc.name}', got ${toolId === null ? 'none' : `'${toolId}'`}`);
  }
  const allowedRoles = extractArrayLiteral(source, 'ALLOWED_ROLES');
  const yamlAllowed = Object.keys(doc.permissions || {}).filter(
    (r) => doc.permissions[r]?.decision === 'allow',
  );
  if (allowedRoles === null) {
    c.fail(`${where}: handler must declare ALLOWED_ROLES`);
  } else {
    if (allowedRoles.includes('judge')) {
      c.fail(`${where}: handler ALLOWED_ROLES must never include judge`);
    }
    if (!sameSet(allowedRoles, yamlAllowed)) {
      c.fail(`${where}: handler ALLOWED_ROLES [${allowedRoles.join(', ')}] disagrees with YAML allowed roles [${yamlAllowed.join(', ')}]`);
    }
  }
  const timeout = extractNumberLiteral(source, 'TIMEOUT_SECONDS');
  if (timeout !== impl.timeoutSeconds) {
    c.fail(`${where}: handler TIMEOUT_SECONDS (${timeout === null ? 'missing' : timeout}) must equal implementation.timeoutSeconds (${impl.timeoutSeconds})`);
  }
  const underlying = impl.kind === 'command'
    ? extractArrayLiteral(source, 'UNDERLYING_COMMAND')
    : extractStringLiteral(source, 'UNDERLYING_COMMAND');
  if (underlying === null) {
    c.fail(`${where}: handler must declare UNDERLYING_COMMAND`);
  } else if (impl.kind === 'command') {
    const argv = impl.argv as string[];
    if (JSON.stringify(underlying) !== JSON.stringify(argv)) {
      c.fail(`${where}: handler UNDERLYING_COMMAND [${(underlying as string[]).join(', ')}] disagrees with implementation.argv [${argv.join(', ')}]`);
    }
  } else if (impl.kind === 'api') {
    const cmd = underlying as string;
    if (!cmd.includes(impl.method) || !cmd.includes(impl.url)) {
      c.fail(`${where}: handler UNDERLYING_COMMAND '${cmd}' must name the api method ${impl.method} and url ${impl.url}`);
    }
  } else if (impl.kind === 'script' && typeof impl.runtime === 'string') {
    if (!(underlying as string).startsWith(impl.runtime)) {
      c.fail(`${where}: handler UNDERLYING_COMMAND '${underlying}' must start with the script runtime ${impl.runtime}`);
    }
  }
  if (impl.fallback && Array.isArray(impl.fallback.argv)) {
    const fallback = extractArrayLiteral(source, 'FALLBACK_COMMAND');
    if (fallback === null) {
      c.fail(`${where}: handler must declare FALLBACK_COMMAND for the YAML fallback`);
    } else if (JSON.stringify(fallback) !== JSON.stringify(impl.fallback.argv)) {
      c.fail(`${where}: handler FALLBACK_COMMAND [${fallback.join(', ')}] disagrees with implementation.fallback.argv [${impl.fallback.argv.join(', ')}]`);
    }
  }
}

function validateTool(c: Checker, doc: YamlDoc, fileName: string, toolsDir: string): YamlDoc | null {
  const where = fileName;
  const id = doc.name;
  if (typeof id !== 'string' || !/^[A-Za-z0-9_.-]{1,128}$/.test(id)) {
    c.fail(`${where}: name must match the MCP rule, 1 to 128 chars, ASCII letters, digits, _ - .`);
    return null;
  }
  if (!isSemver(doc.version)) c.fail(`${where}: version must be SemVer`);
  if (typeof doc.title !== 'string' || !doc.title) c.fail(`${where}: title is required`);
  if (!KINDS.includes(doc.kind)) c.fail(`${where}: kind must be one of ${KINDS.join(', ')}`);
  if (!TOOLSETS.includes(doc.toolset)) c.fail(`${where}: toolset must be one of ${TOOLSETS.join(', ')}`);
  if (typeof doc.description !== 'string' || doc.description.length < 120) {
    c.fail(`${where}: description must be at least 120 chars, 3 or 4 sentences`);
  } else if ((doc.description.match(/\./g) || []).length < 2) {
    c.fail(`${where}: description must be 3 or 4 sentences`);
  }
  if (!isPlainObject(doc.mcp)) return c.fail(`${where}: mcp is required`), null;
  checkSchema(c, doc.mcp.inputSchema, `${where}: mcp.inputSchema`);
  if (doc.mcp.outputSchema !== undefined) checkSchema(c, doc.mcp.outputSchema, `${where}: mcp.outputSchema`);
  const ann = doc.mcp.annotations;
  if (!isPlainObject(ann)) c.fail(`${where}: mcp.annotations is required`);
  if (typeof doc.outputs !== 'string' || !doc.outputs) c.fail(`${where}: outputs is required`);

  const impl = doc.implementation;
  if (!isPlainObject(impl)) c.fail(`${where}: implementation is required`);
  else {
    if (!IMPL_KINDS.includes(impl.kind)) c.fail(`${where}: implementation.kind must be one of ${IMPL_KINDS.join(', ')}`);
    if (typeof impl.timeoutSeconds !== 'number' || impl.timeoutSeconds <= 0) {
      c.fail(`${where}: implementation.timeoutSeconds must be a positive number`);
    }
    if (impl.implemented === false) {
      if (!impl.note || !/not implemented|no .* provider/i.test(impl.note)) {
        c.fail(`${where}: an unimplemented tool must say so in implementation.note and name no provider`);
      }
      if (impl.argv) c.fail(`${where}: an unimplemented tool must not declare argv, or it fakes an implementation`);
      if (impl.handler) c.fail(`${where}: an unimplemented tool must not reference a handler`);
    } else if (impl.implemented === true) {
      if (impl.kind === 'command' && (!Array.isArray(impl.argv) || impl.argv.length === 0)) {
        c.fail(`${where}: a command implementation needs an exact argv`);
      }
      if (impl.kind === 'script' && typeof impl.handler !== 'string') {
        c.fail(`${where}: a script implementation needs a handler description`);
      }
      if (impl.kind === 'api' && (!impl.method || !impl.url)) {
        c.fail(`${where}: an api implementation needs method and url`);
      }
      checkHandler(c, doc, fileName, toolsDir);
    } else {
      c.fail(`${where}: implementation.implemented must be true or false`);
    }
    if (impl.fallback) {
      if (impl.fallback.kind === 'command' && (!Array.isArray(impl.fallback.argv) || impl.fallback.argv.length === 0)) {
        c.fail(`${where}: fallback command needs an exact argv`);
      }
    }
  }

  const eff = doc.effects;
  if (!isPlainObject(eff)) c.fail(`${where}: effects is required`);
  else {
    for (const key of ['writes', 'deletes', 'externalCalls']) {
      if (!Array.isArray(eff[key])) c.fail(`${where}: effects.${key} must be an array`);
    }
    if (typeof eff.reversible !== 'boolean' || typeof eff.idempotent !== 'boolean') {
      c.fail(`${where}: effects.reversible and effects.idempotent must be booleans`);
    }
    if (ann && ann.readOnlyHint === true) {
      if (eff.writes.length || eff.deletes.length || eff.externalCalls.length) {
        c.fail(`${where}: contradiction: readOnlyHint is true but effects list writes, deletes or external calls`);
      }
      if (ann.destructiveHint === true) c.fail(`${where}: contradiction: readOnlyHint true with destructiveHint true`);
    }
    if (ann && typeof ann.idempotentHint === 'boolean' && ann.idempotentHint !== eff.idempotent) {
      c.fail(`${where}: contradiction: annotations.idempotentHint (${ann.idempotentHint}) disagrees with effects.idempotent (${eff.idempotent})`);
    }
  }

  if (!isPlainObject(doc.permissions)) c.fail(`${where}: permissions is required`);
  else {
    for (const role of ROLES) {
      const p = doc.permissions[role];
      if (!isPlainObject(p) || (p.decision !== 'allow' && p.decision !== 'deny')) {
        c.fail(`${where}: permissions.${role} must be {decision: allow|deny}`);
      }
    }
    for (const role of Object.keys(doc.permissions)) {
      if (!ROLES.includes(role)) c.fail(`${where}: permissions has unknown role ${role}`);
    }
    if (doc.permissions.judge.decision !== 'deny') {
      c.fail(`${where}: permissions.judge must be deny, the judge is a decision step, not a tool user`);
    }
  }

  if (!Array.isArray(doc.errors) || doc.errors.length === 0) c.fail(`${where}: errors must be a non-empty list`);
  else {
    const codes = new Set<string>();
    for (const e of doc.errors) {
      if (!/^[A-Z][A-Z0-9_]*$/.test(e.code || '')) c.fail(`${where}: error code ${e.code} must be UPPER_SNAKE`);
      if (codes.has(e.code)) c.fail(`${where}: duplicate error code ${e.code}`);
      codes.add(e.code);
      if (typeof e.retryable !== 'boolean') c.fail(`${where}: error ${e.code} needs retryable as a boolean`);
      if (!e.when || !e.message) c.fail(`${where}: error ${e.code} needs when and message`);
    }
  }
  if (!Array.isArray(doc.examples) || doc.examples.length === 0) c.fail(`${where}: examples must be a non-empty list`);
  else {
    for (const ex of doc.examples) {
      if (!ex.description || !isPlainObject(ex.input)) c.fail(`${where}: each example needs description and input`);
      if (!('output' in ex) && !('error' in ex)) c.fail(`${where}: each example needs output or error`);
    }
  }
  return doc;
}

function readFrontmatterTools(c: Checker, agentsDir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!fs.existsSync(agentsDir)) return out;
  for (const file of fs.readdirSync(agentsDir).filter((f) => f.endsWith('.md'))) {
    // Windows checkouts use CRLF; normalize first so the frontmatter
    // regexes below see the same line endings on every platform.
    const text = fs.readFileSync(path.join(agentsDir, file), 'utf8').replace(/\r\n/g, '\n');
    const nameMatch = text.match(/^name:\s*(\S+)/m);
    const toolsMatch = text.match(/^tools:\n((?:  - \S+\n)+)/m);
    if (!nameMatch || !toolsMatch) {
      c.fail(`agents/${file}: cannot read frontmatter name and tools list`);
      continue;
    }
    out[nameMatch[1]] = toolsMatch[1].split('\n').filter(Boolean).map((l) => l.replace(/^  - /, '').trim());
  }
  return out;
}

function checkToolsJson(c: Checker, toolsDir: string, tools: YamlDoc[]): void {
  const p = path.join(toolsDir, 'tools.json');
  if (!fs.existsSync(p)) {
    c.fail('tools/tools.json: missing, run `wekyt validate --generate` to regenerate it from the YAML files');
    return;
  }
  let registry: any;
  try {
    registry = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    c.fail(`tools/tools.json: invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!Array.isArray(registry.tools)) {
    c.fail('tools/tools.json: tools must be a list');
    return;
  }
  if (registry.version !== 3) {
    c.fail(`tools/tools.json: version must be 3, got ${String(registry.version)}`);
  }
  const byId = new Map<string, any>();
  for (const t of registry.tools) {
    if (typeof t.id === 'string') byId.set(t.id, t);
  }
  for (const tool of tools) {
    const entry = byId.get(tool.name);
    if (!entry) {
      c.fail(`tools/tools.json: missing entry for ${tool.name}`);
    } else if (entry.version !== tool.version) {
      c.fail(`tools/tools.json: version mismatch for ${tool.name}: registry has ${entry.version}, ${tool.name}.yaml has ${tool.version}`);
    } else if (entry.handler !== tool.implementation.handler || entry.invoke !== tool.implementation.invoke) {
      c.fail(`tools/tools.json: handler mismatch for ${tool.name}: registry has ${String(entry.handler)} / ${String(entry.invoke)}, ${tool.name}.yaml has ${tool.implementation.handler} / ${tool.implementation.invoke}`);
    }
  }
  for (const id of byId.keys()) {
    if (!tools.some((t) => t.name === id)) c.fail(`tools/tools.json: extra entry ${id} with no matching YAML file`);
  }
}

function checkPermissionsMatrix(c: Checker, toolsDir: string, tools: YamlDoc[]): void {
  const p = path.join(toolsDir, 'permissions.md');
  if (!fs.existsSync(p)) {
    c.fail('tools/permissions.md: missing, run `wekyt validate --generate` to regenerate it from the YAML files');
    return;
  }
  const text = fs.readFileSync(p, 'utf8');
  const matrixIndex = text.indexOf('## Matrix');
  if (matrixIndex < 0) {
    c.fail('tools/permissions.md: no ## Matrix section');
    return;
  }
  const rows = new Map<string, Record<string, string>>();
  for (const line of text.slice(matrixIndex).split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || trimmed.includes('---')) continue;
    const cells = trimmed.split('|').slice(1, -1).map((s) => s.trim());
    if (cells.length < 6 || cells[0] === 'Tool') continue;
    const decisions: Record<string, string> = {};
    for (let i = 1; i < cells.length; i++) {
      const role = ROLE_COLUMNS[['Orchestrator', 'Architect', 'Dev', 'QA', 'Security'][i - 1]];
      if (role) decisions[role] = cells[i].startsWith('yes') ? 'allow' : 'deny';
    }
    rows.set(cells[0], decisions);
  }
  for (const tool of tools) {
    const row = rows.get(tool.name);
    if (!row) {
      c.fail(`tools/permissions.md: no matrix row for ${tool.name}`);
      continue;
    }
    for (const role of MATRIX_ROLES) {
      const expected = tool.permissions[role]?.decision;
      if (row[role] !== expected) {
        c.fail(`tools/permissions.md: matrix says ${tool.name} is ${row[role]} for ${role}, but ${tool.name}.yaml says ${expected}`);
      }
    }
  }
}

function listMarkdownFiles(dir: string): string[] {
  const out: string[] = [];
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, {withFileTypes: true})) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function checkSkills(c: Checker, skillsDir: string): number {
  // README.md is the folder documentation, not a skill, so it is skipped.
  const files = listMarkdownFiles(skillsDir).filter((f) => path.basename(f) !== 'README.md');
  const names = new Set<string>();
  for (const file of files) {
    const rel = `skills/${path.relative(skillsDir, file).split(path.sep).join('/')}`;
    // Windows checkouts use CRLF; normalize first so the frontmatter
    // regex below sees the same line endings on every platform.
    const text = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const match = text.match(/^---\n([\s\S]*?)\n---\n/);
    if (!match) {
      c.fail(`${rel}: no frontmatter block, a skill needs name and description in frontmatter`);
      continue;
    }
    let front: any;
    try {
      front = YAML.parse(match[1]);
    } catch (e) {
      c.fail(`${rel}: invalid frontmatter YAML: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    if (!isPlainObject(front)) {
      c.fail(`${rel}: frontmatter must be a YAML object`);
      continue;
    }
    if (typeof front.name !== 'string' || !front.name.trim()) {
      c.fail(`${rel}: frontmatter name is required`);
    } else if (names.has(front.name)) {
      c.fail(`${rel}: duplicate skill name ${front.name}`);
    } else {
      names.add(front.name);
    }
    if (typeof front.description !== 'string' || !front.description.trim()) {
      c.fail(`${rel}: frontmatter description is required`);
    }
  }
  return files.length;
}

function checkProjectConfig(c: Checker, aiDir: string): void {
  const p = path.join(aiDir, 'wekyt.config.json');
  if (!fs.existsSync(p)) return;
  let cfg: any;
  try {
    cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    c.fail(`wekyt.config.json: invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!HARNESSES.includes(cfg.harness)) {
    c.fail(`wekyt.config.json: harness must be one of ${HARNESSES.join(', ')}, got ${String(cfg.harness)}`);
  }
  if (typeof cfg.configVersion !== 'number') {
    c.fail('wekyt.config.json: configVersion must be a number');
  }
}

/** Validate a project team. Returns every error found, never throws for bad input. */
export function validateProject(projectDir: string): ValidationResult {
  const c = new Checker();
  const aiDir = path.join(projectDir, 'ai');
  if (!fs.existsSync(aiDir)) {
    return {ok: false, errors: ['ai/: no ai/ folder in this project, run `wekyt install` first'], tools: 0, skills: 0};
  }
  const toolsDir = path.join(aiDir, 'tools');
  const agentsDir = path.join(aiDir, 'agents');
  const skillsDir = path.join(aiDir, 'skills');
  if (!fs.existsSync(path.join(aiDir, 'VERSION'))) c.fail('ai/VERSION: missing, the team version is unknown');
  if (!fs.existsSync(toolsDir)) c.fail('ai/tools: missing folder');
  if (!fs.existsSync(agentsDir)) c.fail('ai/agents: missing folder');

  let tools: YamlDoc[] = [];
  if (fs.existsSync(toolsDir)) {
    const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith('.yaml')).sort();
    for (const file of files) {
      let doc: any;
      try {
        doc = YAML.parse(fs.readFileSync(path.join(toolsDir, file), 'utf8'));
      } catch (e) {
        c.fail(`${file}: invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const valid = validateTool(c, doc, file, toolsDir);
      if (valid) tools.push(valid);
    }
    const ids = tools.map((t) => t.name);
    for (const expected of TOOL_ORDER) {
      if (!ids.includes(expected)) c.fail(`missing tool definition: ${expected}.yaml`);
    }
    for (const id of ids) {
      if (!TOOL_ORDER.includes(id)) c.fail(`unexpected tool definition: ${id}.yaml`);
    }
    if (new Set(ids).size !== ids.length) c.fail('duplicate tool ids');

    const frontmatter = readFrontmatterTools(c, agentsDir);
    for (const role of ['orchestrator', 'architect', 'dev', 'qa', 'security']) {
      const allowed = tools.filter((t) => t.permissions[role].decision === 'allow').map((t) => t.name).sort();
      const listed = [...(frontmatter[role] || [])].sort();
      if (JSON.stringify(allowed) !== JSON.stringify(listed)) {
        c.fail(`permissions mismatch for ${role}: YAML allows [${allowed.join(', ')}] but ai/agents/${role}.md lists [${listed.join(', ')}]`);
      }
    }
    checkToolsJson(c, toolsDir, tools);
    checkPermissionsMatrix(c, toolsDir, tools);
  }

  const skills = fs.existsSync(skillsDir) ? checkSkills(c, skillsDir) : 0;
  checkProjectConfig(c, aiDir);
  return {ok: c.errors.length === 0, errors: c.errors, tools: tools.length, skills};
}

/** Regenerate tools.json and the permissions.md matrix from the YAML files. */
export function generateRegistry(projectDir: string): {tools: number} {
  const c = new Checker();
  const toolsDir = path.join(projectDir, 'ai', 'tools');
  const agentsDir = path.join(projectDir, 'ai', 'agents');
  if (!fs.existsSync(toolsDir)) throw new Error(`no ai/tools folder in ${projectDir}`);
  const files = fs.readdirSync(toolsDir).filter((f) => f.endsWith('.yaml')).sort();
  const tools: YamlDoc[] = [];
  for (const file of files) {
    const doc = YAML.parse(fs.readFileSync(path.join(toolsDir, file), 'utf8'));
    const valid = validateTool(c, doc, file, toolsDir);
    if (valid) tools.push(valid);
  }
  if (c.errors.length > 0) {
    throw new Error(`cannot generate: ${c.errors.length} validation error(s), first: ${c.errors[0]}`);
  }
  const ordered = [...tools].sort((a, b) => TOOL_ORDER.indexOf(a.name) - TOOL_ORDER.indexOf(b.name));
  const registry = {
    description: 'Tool registry for the wekyt hub. Generated from ai/tools/*.yaml, do not edit by hand. Agents discover tools by description. No tool belongs to an agent. Access is granted per role under least privilege in permissions.md.',
    tools: ordered.map((t) => ({
      description: t.description.replace(/\s+/g, ' ').trim(),
      handler: t.implementation.handler,
      id: t.name,
      invoke: t.implementation.invoke,
      kind: t.kind,
      name: t.title,
      toolset: t.toolset,
      version: t.version,
    })),
    version: 3,
  };
  fs.writeFileSync(path.join(toolsDir, 'tools.json'), JSON.stringify(registry, null, 2) + '\n');

  const permPath = path.join(toolsDir, 'permissions.md');
  const existing = fs.existsSync(permPath) ? fs.readFileSync(permPath, 'utf8') : '';
  const hardRulesIndex = existing.indexOf('## Hard rules');
  const hardRules = hardRulesIndex >= 0 ? existing.slice(hardRulesIndex) : '';
  const header = '# Permissions\n\nLeast privilege by role. A tool listed in `tools.json` is available to the system, but no agent may use a tool that is not in its own frontmatter `tools` list. If a tool is not listed for a role, that role cannot use it, even when the tool exists in the registry. This matrix is generated from `ai/tools/*.yaml`, do not edit it by hand.\n\n## Matrix\n\n';
  const cols = ['Tool', 'Orchestrator', 'Architect', 'Dev', 'QA', 'Security'];
  const rows = ordered.map((t) => {
    const cell = (role: string) => {
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
  return {tools: tools.length};
}
