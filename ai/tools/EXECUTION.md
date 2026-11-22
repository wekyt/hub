# Executable tools: how a harness invokes a handler

Decision for 0.4.0. The tool store stops being a set of descriptions and
becomes callable code. Each tool has one handler script, and the handler is
the implementation the YAML points at.

## The shape

A handler is a standalone ESM script: `ai/tools/handlers/<id>.mjs`, with a
shebang, runnable as `node ai/tools/handlers/<id>.mjs`. No server, no
daemon, no extra process to keep alive.

- Input: one JSON object on stdin, the tool input from the YAML
  `inputSchema`. Empty stdin means `{}`.
- Output: one JSON object on stdout, nothing else. Success is
  `{ok: true, ...result}` where the result fields are exactly the YAML
  `outputSchema` properties. Failure is
  `{ok: false, error: {code, message, retryable}}` with process exit code 1.
  The error code is always one of the codes listed in the YAML.
- stderr is free for human readable logs. It never carries the result.
- A handler never crashes with a stack trace. Unexpected failures surface
  as `INTERNAL_ERROR`, exit code 1.

## Environment

- `WEKYT_PROJECT_ROOT`: the project the tool works on. Default is the
  current working directory. Every path input is resolved inside it.
- `WEKYT_ROLE`: the calling role, when the harness knows it. When set, the
  handler enforces the YAML allow and deny list and refuses with
  `PERMISSION_DENIED`. The same role can be passed as `_role` in the input
  JSON; it is stripped before validation. When no role is supplied, the
  handler runs in harness trusted mode and performs no role check: the
  harness owns the call. Scope text in a YAML permission (for example
  "architecture documents only") is enforced by the harness and the
  orchestrator, not by the handler. The handler enforces only allow and
  deny.
- `GITHUB_TOKEN`: GitHub authentication for `open_pull_request` and
  `merge_pull_request`. The `gh` CLI session is the fallback when no token
  is set.
- `WEKYT_GITHUB_API_URL`: base URL of the GitHub REST API. Default is
  `https://api.github.com`. Tests point it at a local stub server.
- `WEKYT_WEB_SEARCH_PROVIDER`: search provider for `web_search`. Default
  is `duckduckgo`, the DuckDuckGo Instant Answer API, which needs no key.
  Set it to `none` and the tool returns `NOT_IMPLEMENTED`, never a faked
  result.
- `WEKYT_DDG_API_URL`: base URL of the DuckDuckGo API. Default is
  `https://api.duckduckgo.com`. Tests point it at a local stub server.

## What a handler must honor

- Path containment: every path input resolves inside the project root.
  Absolute paths, `..` escapes and symlinks that leave the root are
  refused with `PATH_OUTSIDE_PROJECT`.
- Secrets deny list: no handler reads, writes, lists or searches a secret
  path. Secret means a file named `.env` or starting with `.env.`, any
  `*.pem` or `*.key` file, a file named `id_rsa*`, `id_ed25519*`,
  `id_ecdsa*` or `id_dsa*`, any path segment containing `credentials` or
  `secret`, and anything under `.ssh`, `.aws` or `.gnupg`. File tools
  refuse with `SECRET_PATH`. `list_files` and `search_code` skip secret
  files silently instead of listing them.
- Binary files: a file with a NUL byte in its first 8 KB is binary and is
  refused with `BINARY_FILE`. Handlers never dump binary content as text.
- Timeouts: every handler enforces the YAML `timeoutSeconds`, and every
  child process it spawns is killed on timeout. The timeout error code of
  each tool is returned, never a hang.
- No fake results: a tool that cannot run reports the exact error from its
  YAML (`TOOL_NOT_CONFIGURED`, `NOT_IMPLEMENTED`, `NOT_AUTHENTICATED`)
  and runs nothing.

## Embedded constants the validator checks

Every handler exports, as plain single quoted literals the validator can
read:

- `TOOL_ID`: the tool id, equal to the YAML `name`.
- `ALLOWED_ROLES`: the roles with decision `allow` in the YAML
  permissions. The judge is never in the list.
- `TIMEOUT_SECONDS`: equal to the YAML `implementation.timeoutSeconds`.
- `UNDERLYING_COMMAND`: the exact underlying operation, in the form the
  validator compares against the YAML. For `command` kind it is the exact
  YAML `argv` template as an array, placeholders included. For `api` kind
  it is the method and URL template as one string. For `script` kind it
  is the runtime string from the YAML, starting with `runtime`.
- `FALLBACK_COMMAND`: only when the YAML declares a command fallback. It
  is the exact fallback `argv` template as an array.

The YAML `implementation` section points at the handler: `handler` is the
path `ai/tools/handlers/<id>.mjs` and `invoke` is the canonical command
`node ai/tools/handlers/<id>.mjs`. A tool cannot claim `implemented: true`
without an existing handler that passes `node --check` and matches its
YAML on all four constants. An unimplemented tool must not reference a
handler.

## Decisions that resolve YAML contradictions

- `open_pull_request` says in its notes that a second call with the same
  head returns the existing pull request, and lists `PR_EXISTS` as an
  error. The handler is idempotent: it first looks up an open pull request
  for the head branch and returns it when one exists. `PR_EXISTS` is
  returned only when the API reports a duplicate that cannot be retrieved.
- `search_code` lists `NO_MATCHES` as an error. The handler keeps it:
  no match is an error, the same way `grep` exits 1 with no match.
- `run_linter` and `run_checker` return parsed violations and findings,
  but parsing is best effort over the runner output. The pass or fail
  verdict always comes from the runner exit code, never from parsing.

## What was rejected, and why

- An MCP server was rejected. The exec plus JSON contract already gives a
  harness everything it needs to call a tool: a command line, a JSON
  input, a JSON output, and an exit code. A server would add a long lived
  process, protocol framing and a transport, with no extra capability for
  a local harness. If a remote harness needs MCP later, the same handlers
  can sit behind it without changing.
- A runtime or ExecutionDriver that executes agents was rejected for this
  version. It is a later phase. These handlers execute tools, not agents.
  The harness still owns the agent loop, the brief, the plan and the
  merge decision.
