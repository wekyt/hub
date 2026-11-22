# Tool store

## How it works

The tool store is a transversal registry. Every tool the system can use is defined once, in its own YAML file in this folder, with an id, a name, a description, input and output schemas, the exact implementation, errors, effects, and permissions per role. Agents do not own tools. An agent discovers a tool by reading its description, and it may use a tool only when that tool id appears in the `tools` list in its own frontmatter.

`tools.json` is a generated index built from the YAML files, not the source of truth: do not edit it by hand. The same goes for the matrix in `permissions.md`, which is generated from the same YAML files. The hard rules at the end of `permissions.md` are hand written and are kept when the matrix regenerates.

This design has three consequences:

- A tool is defined once and reused by every role that needs it. Adding a capability means adding one registry entry, not copying code into an agent.
- A role gets the minimum it needs. The frontmatter list is the permission boundary. If a tool is not listed for a role, that role cannot use it, even when the tool exists in the registry.
- A review can check permissions without reading agent prompts. The matrix in `permissions.md` is the single source of truth for who can do what.

## Executable handlers

A tool is not a description: it is callable code. Every tool that claims `implemented: true` ships one handler script in `handlers/`, `ai/tools/handlers/<id>.mjs`, and the YAML `implementation` section points at it with `handler` and `invoke`. A harness calls a tool by running `node ai/tools/handlers/<id>.mjs`, sending one JSON object on stdin and reading one JSON object on stdout: `{ok: true, ...result}` on success, `{ok: false, error: {code, message, retryable}}` with exit code 1 on failure. No server, no daemon, no extra process to keep alive. The full contract, including environment variables, safety rules and the rejected alternatives, is in `EXECUTION.md`.

The validator enforces the link: a tool cannot claim `implemented: true` without an existing handler that passes `node --check` and agrees with its YAML on tool id, allowed roles, timeout, underlying command and fallback command. Every handler is covered by tests in `cli/test/tools-handlers.test.mjs`, which run each one against a fixture temp project and assert real behavior.

## Discovery by description

When an agent needs a capability, it reads the registry and matches the task to a description:

- Need to read code before deciding: `read_file`, `list_files` or `search_code`.
- Need to change code: `write_file`, restricted to the dev and to the files in the approved architecture, or `edit_file` for a surgical change.
- Need to prove the change works: `run_tests`, `run_linter`, `run_checker`, `run_build`.
- Need outside information: `web_search` or `fetch_url`.
- Need to move work through git: `git_branch`, `git_commit`, `git_push`, `open_pull_request`, `merge_pull_request`.
- Need to stay safe: `rollback`, `audit_log`.

No agent may invent a tool, call a tool by a name that is not in the registry, or use a tool outside its frontmatter list. When no registered tool fits, the agent reports the gap to the orchestrator instead of working around it.

## No tool belongs to an agent

Tools are shared infrastructure. `run_tests` is used by both the dev, for a local check before opening a pull request, and by QA, for the objective gate. `read_file` and `search_code` are used by every role. `audit_log` is used by every role, and the log is append only.

Ownership would break this. If a tool belonged to one agent, other agents would duplicate it or ask that agent for favors, and permissions would hide inside prompts. In the store, the registry defines the tool and `permissions.md` defines who may use it. Both are plain files, and both are reviewable.

## How to add a new tool

1. Add one file `<id>.yaml` in this folder, copying an existing tool as the template. Use a short snake_case id. Write the description so an agent can decide from it alone: what the tool does, what it returns, and what it must never be used for. Fill in every field: input and output schemas (JSON Schema 2020-12), the exact implementation (kind `api`, `command`, `script` or `mcp_passthrough`, with method and URL, or exact argv), errors, effects, permissions per role, and examples. Then write the handler in `handlers/<id>.mjs` following `EXECUTION.md`, and point the YAML `implementation` at it with `handler` and `invoke`. When a tool has no real implementation, mark `implemented: false` and say so: never fake one.
2. Set permissions per role in the same YAML file. Default is deny for every role. Grant the tool only to the roles that need it, and only for the narrowest use that satisfies the need. The judge is always deny: it is a decision step, not a tool user.
3. Add the tool id to the frontmatter `tools` list of each agent file in `ai/agents/` that is granted access. The frontmatter list, the matrix, and the registry must agree. If they disagree, the matrix in `permissions.md` decides, and the mismatch is a defect to fix before use.
4. If the tool writes state, moves code, or changes access, add one hard rule to `permissions.md` stating who may use it and under which condition. Merge, rollback, and pull request tools already have such rules. Follow that pattern.
5. Run the validator from the repo root of the hub: `node cli/scripts/validate-tools.mjs --generate`. It checks every definition (including contradictions, for example a tool with `readOnlyHint: true` and write effects), checks that permissions match the agent frontmatter lists, checks that every implemented tool ships a handler that agrees with its YAML, and regenerates `tools.json` and the matrix in `permissions.md`. It must pass with no errors before the change is used. Add at least one test for the new handler in `cli/test/tools-handlers.test.mjs` and run `pnpm test`.
6. Record the change in the audit log with the reason for the new tool, the roles granted access, and the roles denied access.

## Files

- `<id>.yaml`: one file per tool. The source of truth for that tool.
- `handlers/<id>.mjs`: the executable handler for the tool, one script per tool. See `EXECUTION.md` for the contract.
- `EXECUTION.md`: the execution shape decision, the handler contract, and the rejected alternatives.
- `tools.json`: the registry, generated from the YAML files. One entry per tool, with id, name, description, kind, toolset, version, handler and invoke. Do not edit by hand.
- `permissions.md`: the permission matrix by role (generated from the YAML files), plus the hard rules that no frontmatter list may override.
- `README.md`: this file. How the store works, how discovery works, and how to add a tool.

## Toolsets

Tools are grouped by domain, following the GitHub MCP server pattern: `read` (read only), `write`, `git`, `test`, and `safety`. The default toolset is read only. The `write` toolset exists because `write_file` is not read only, so it fits none of the other four.
