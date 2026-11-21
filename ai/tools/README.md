# Tool store

## How it works

The tool store is a transversal registry. Every tool the system can use is listed once in `tools.json`, with an id, a name, a description, and a kind. Agents do not own tools. An agent discovers a tool by reading its description, and it may use a tool only when that tool id appears in the `tools` list in its own frontmatter.

This design has three consequences:

- A tool is defined once and reused by every role that needs it. Adding a capability means adding one registry entry, not copying code into an agent.
- A role gets the minimum it needs. The frontmatter list is the permission boundary. If a tool is not listed for a role, that role cannot use it, even when the tool exists in the registry.
- A review can check permissions without reading agent prompts. The matrix in `permissions.md` is the single source of truth for who can do what.

## Discovery by description

When an agent needs a capability, it reads the registry and matches the task to a description:

- Need to read code before deciding: `read_file` or `search_code`.
- Need to change code: `write_file`, restricted to the dev and to the files in the approved architecture.
- Need to prove the change works: `run_tests`, `run_linter`, `run_checker`.
- Need outside information: `web_search`.
- Need to move work through git: `git_branch`, `git_commit`, `git_push`, `open_pull_request`, `merge_pull_request`.
- Need to stay safe: `rollback`, `audit_log`.

No agent may invent a tool, call a tool by a name that is not in the registry, or use a tool outside its frontmatter list. When no registered tool fits, the agent reports the gap to the orchestrator instead of working around it.

## No tool belongs to an agent

Tools are shared infrastructure. `run_tests` is used by both the dev, for a local check before opening a pull request, and by QA, for the objective gate. `read_file` and `search_code` are used by every role. `audit_log` is used by every role, and the log is append only.

Ownership would break this. If a tool belonged to one agent, other agents would duplicate it or ask that agent for favors, and permissions would hide inside prompts. In the store, the registry defines the tool and `permissions.md` defines who may use it. Both are plain files, and both are reviewable.

## How to add a new tool

1. Add one entry to `tools.json` with id, name, description, and kind. Use a short snake_case id. Write the description so an agent can decide from it alone: what the tool does, what it returns, and what it must never be used for.
2. Add one row to the matrix in `permissions.md`, with yes or no per role. Default is no for every role. Grant the tool only to the roles that need it, and only for the narrowest use that satisfies the need.
3. Add the tool id to the frontmatter `tools` list of each agent file in `ai/agents/` that is granted access. The frontmatter list, the matrix, and the registry must agree. If they disagree, the matrix in `permissions.md` decides, and the mismatch is a defect to fix before use.
4. If the tool writes state, moves code, or changes access, add one hard rule to `permissions.md` stating who may use it and under which condition. Merge, rollback, and pull request tools already have such rules. Follow that pattern.
5. Record the change in the audit log with the reason for the new tool, the roles granted access, and the roles denied access.

## Files

- `tools.json`: the registry. One entry per tool, with id, name, description, and kind.
- `permissions.md`: the permission matrix by role, plus the hard rules that no frontmatter list may override.
- `README.md`: this file. How the store works, how discovery works, and how to add a tool.
