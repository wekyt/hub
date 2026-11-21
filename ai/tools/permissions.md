# Permissions

Least privilege by role. A tool listed in `tools.json` is available to the system, but no agent may use a tool that is not in its own frontmatter `tools` list. If a tool is not listed for a role, that role cannot use it, even when the tool exists in the registry. This matrix is generated from `ai/tools/*.yaml`, do not edit it by hand.

## Matrix

| Tool | Orchestrator | Architect | Dev | QA | Security |
| --- | --- | --- | --- | --- | --- |
| read_file | yes | yes | yes | yes | yes |
| write_file | no | yes, architecture documents and design notes only | yes, files listed in the approved architecture only | no | no |
| search_code | yes | yes | yes | yes | yes |
| run_tests | no | no | yes | yes | no |
| run_linter | no | no | yes | yes | no |
| run_checker | no | no | yes | yes | yes |
| web_search | yes | yes | no | no | yes |
| git_branch | yes | no | yes | no | no |
| git_commit | no | no | yes | no | no |
| git_push | no | no | yes | no | no |
| open_pull_request | yes | no | yes | no | no |
| merge_pull_request | yes, merge step only, and only when architect, dev, QA with tests green, and security all agree | no | no | no | no |
| rollback | yes, when a merge fails, post merge checks fail, or a regression is detected after merge | no | no | no | no |
| audit_log | yes | yes | yes | yes | yes |

## Hard rules

- No agent reads secret material. Files matching .env, *.pem, *.key, credentials, tokens, private keys, or any path marked secret are off limits for every role, including read_file and search_code. No agent includes a secret in context, in a handoff, in a log, or in an audit entry. If a task needs a secret to run, the dev uses a placeholder and notes it in the pull request.
- QA cannot open a pull request. The tool open_pull_request exists in the registry, but it is not in the QA frontmatter list, and QA must never request it. When QA finds a fixable problem, it reports the finding and returns the task to the dev through the orchestrator. It never opens a pull request itself.
- Dev cannot merge. The tool merge_pull_request is not in the dev frontmatter list, and the dev must never ask another agent to merge outside the orchestrator merge step.
- Only the merge step of the orchestrator can use merge_pull_request, and only when all layers agree: architect, dev, QA with tests green, and security. Partial agreement is not enough. A merge without an audit entry written before it runs is forbidden.
- Only the orchestrator can use rollback. Rollback runs automatically when a merge fails, when post merge checks fail, or when a regression is detected after merge.
- Security does not approve its own findings. A finding raised by security can only be closed after a fix is present in the reviewed branch and security re-reviews it. Security never marks its own report as resolved without that second check.
- The orchestrator never writes code. It has no write_file access, and it must delegate every code change to the dev.
- QA never writes code. It has no write_file access. Its job is to test and prove, not to repair.
- Security never writes code. It has no write_file access. It reports the fix required and returns the task to the dev.
- The architect writes only architecture documents and design notes. It never writes production code, test code, or configuration for the build.
- The dev writes only files listed in the approved architecture. It never changes files listed as untouched without a revised architecture.
- Every agent can use audit_log. The log is append only. No agent can edit or delete an audit entry.
- A role that needs a tool it does not have must ask the orchestrator, which either delegates the work to a role that has the tool, or rejects the request with a reason. No role grants itself a new tool.
