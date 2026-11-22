# wekyt CLI

The command line tool for the wekyt hub. One command, zero questions, for the team and for itself.

## Install

```bash
npx wekyt
```

That opens the interactive menu. No install step: npx downloads the `wekyt` package and runs it. Node.js 22.12 or newer is required.

To install the CLI itself, so `wekyt` works without npx:

```bash
npm install -g wekyt
```

or, with pnpm:

```bash
pnpm add -g wekyt
```

To install only the team, without Node, use the curl installer from the hub README instead. Note: the curl installer (`install.sh`) still needs `curl` and `tar` on PATH; it is a shell script by design. The CLI itself needs neither: it downloads with native `fetch` and extracts with the pure JavaScript `tar` package, so `install`, `update` and `doctor` work on a machine with no `curl` or `tar` installed.

## Commands

All commands run in the current project folder, unless `--project <dir>` is given before the subcommand.

| Command | What it does |
| --- | --- |
| `wekyt` | Open the interactive menu (install, update, configure harness, status, update CLI, uninstall, exit). Needs a terminal. |
| `wekyt install` | Install the dev team into `./ai/` from the latest GitHub release, SHA-256 verified. Refuses when `ai/` exists, unless `--force`. `--tag vX.Y.Z` pins a release. Writes `./ai/.wekyt-manifest.json` listing every file the release shipped with its SHA-256. |
| `wekyt update` | Update the installed team to the latest release of the channel. `--check` only reports versions. `--channel latest` or `--channel stable` picks the channel. `--rollback` restores the previous saved copy of `ai/`. |
| `wekyt update --self` | Update the CLI itself with `npm install -g wekyt@latest`, or `pnpm add -g wekyt@latest` when it was installed with pnpm. This is a different update from `wekyt update`, which updates the team. |
| `wekyt validate` | Validate `./ai/`: tool definitions (`ai/tools/*.yaml`), their consistency with `tools.json` and the permissions matrix, that every implemented tool ships a handler in `ai/tools/handlers/` that agrees with its YAML (tool id, allowed roles, timeout, underlying command, fallback), and your own skills (frontmatter, required fields, no name collisions). Exit 0 when valid, 1 on errors, naming the exact file and field. `--json` prints a machine readable report. `--generate` validates and regenerates `tools.json` and the permissions matrix. |
| `wekyt init` | Configure the harness that reads `./ai/`. Writes `./ai/wekyt.config.json` with the harness name, and a bridge file the harness reads (see below). Detects `claude`, `gemini` and `codex` on PATH (checks `--version`) and a `.cursor/` folder for Cursor. `--harness <name>` skips the picker. Never runs agents and never asks for API keys. |
| `wekyt --version` | Show CLI version, install method (npm, pnpm, curl, or local) and channel. |
| `wekyt doctor` | Check Node >= 22.12, the installed team, the validation of `./ai/`, the configured harness, and update state. `--json` prints a machine readable report and exits 1 when a fail check is present. No external binary is needed: downloads use native fetch and extraction is pure JavaScript. |
| `wekyt uninstall` | Remove `./ai/`, with confirmation unless `--yes`. Warns when `ai/` holds your own files (not part of the team). Nothing outside `ai/` is touched. |

## Your files are never deleted by install or update

Every install writes `./ai/.wekyt-manifest.json`: the team version, the install date, and the SHA-256 of every file the release shipped. On update or `install --force`:

- Files the release shipped and you never touched are replaced by the new version.
- Files the release shipped and you modified are saved as `.bak` next to the new file, and the update reports them.
- Your own files (skills, local configs, anything no manifest lists) are kept untouched. The new release never overwrites or deletes them, even with `--force`.

`--force` means "replace tracked team files even if modified (with `.bak`)", never "wipe `./ai/`". Rollback snapshots live in `~/.wekyt/backups/` (latest 5 kept) and `wekyt update --rollback` restores the previous copy of `ai/`, your files included.

## Harness bridge files

`wekyt init` writes `./ai/wekyt.config.json` as `{"harness": "<name>", "configVersion": 1}` and creates one bridge file at the project root (or under `.cursor/` for Cursor) that points the harness at `./ai/`:

| Harness | Bridge file |
| --- | --- |
| `claude` | `CLAUDE.md` |
| `cursor` | `.cursor/rules/wekyt.mdc` |
| `codex` | `AGENTS.md` |
| `gemini` | `GEMINI.md` |

The bridge file is a short pointer: read `ai/CONTEXT.md` for the team map and `ai/README.md` for the rules, then follow the orchestrator flow (brief, plan, architecture, build, QA). If the bridge file already exists, it is never modified: `wekyt init` reports the exact snippet to add instead. If `./ai/wekyt.config.json` already exists, `wekyt init` asks before overwriting it, unless `--force`.

## Updates, channels and the background check

Two updates, never mixed: `wekyt update` updates the team (`ai/`), `wekyt update --self` updates the CLI. The channels are `latest` (default, the newest published version) and `stable` (a version tagged stable, typically one week older with no major regressions). The channel lives in `~/.wekyt/config.json` as `autoUpdatesChannel`.

On startup, the CLI checks at most once every 24 hours, in a detached background process with a 3 second timeout, whether a newer CLI version exists on npm. The check never blocks a command, never sends tokens, paths or project data, and a network failure is swallowed silently. When a newer version exists, the next run prints a line on stderr: `Update available: wekyt X -> Y. Run 'wekyt update --self' to apply it.` Set `WEKYT_NO_AUTO_UPDATE=1` to turn the check off.

## Security

The team package is downloaded only from `github.com/wekyt/hub/releases` (or from the npm registry for the CLI itself), never from a user supplied URL, except for the test overrides below. Its SHA-256 is verified against the `SHA256SUMS` file published with the release before anything is extracted. When the release publishes no checksums file, or the hash does not match, nothing is installed and the temporary files are deleted. Release v0.1.0 publishes no checksums file, so installs from it are refused; v0.2.0 must publish `SHA256SUMS` next to `wekyt-hub.tar.gz`.

Test overrides, same names as `install.sh` uses:

- `WEKYT_TARBALL=<path to a local .tar.gz>`: use a local package instead of downloading.
- `WEKYT_RELEASE_URL=<url>`: use another release asset URL.
- `WEKYT_SHA256SUMS=<path to a checksums file>`: use a local checksums file.
- `WEKYT_FORCE=1`: same as `install --force`, kept for parity with `install.sh`.

## Development

This project uses pnpm (pinned in `package.json` as `packageManager`). Install it with `corepack enable` or from https://pnpm.io/installation, then:

```bash
pnpm install
pnpm build    # esbuild bundles src/cli.tsx into dist/wekyt.js, one file
pnpm test         # CLI integration tests, tools validation tests, TUI tests
pnpm typecheck
pnpm tools:validate          # validate ai/tools/*.yaml
pnpm tools:generate          # validate and regenerate tools.json and the permissions matrix
```

pnpm 10 blocks install scripts of dependencies by default. That is intentional: esbuild works without its postinstall script because its platform binary arrives as an optional dependency. Do not approve builds unless a dependency genuinely needs its script, and record why.

The bundle is ESM in a single file. Ink 8 needs top-level await, so a CJS bundle is not possible; the `signal-exit` CJS entry is aliased to a minimal shim in `src/lib/signal-exit-shim.mjs` because esbuild cannot bundle its `require('assert')` into ESM output, and the bundle defines `require` through `createRequire` for the remaining CJS dependencies that call it at runtime. Both workarounds are commented where they live.

Publishing the package is a separate, manual step done by the main agent in the browser. See `PUBLISHING.md`.
