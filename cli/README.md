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

To install only the team, without Node, use the curl installer from the hub README instead.

## Commands

All commands run in the current project folder, unless `--project <dir>` is given before the subcommand.

| Command | What it does |
| --- | --- |
| `wekyt` | Open the interactive menu (install, update, status, update CLI, uninstall, exit). Needs a terminal. |
| `wekyt install` | Install the dev team into `./ai/` from the latest GitHub release, SHA-256 verified. Refuses when `ai/` exists, unless `--force`. `--tag vX.Y.Z` pins a release. |
| `wekyt update` | Update the installed team to the latest release of the channel. `--check` only reports versions. `--channel latest` or `--channel stable` picks the channel. `--rollback` restores the previous saved copy of `ai/`. |
| `wekyt update --self` | Update the CLI itself with `npm install -g wekyt@latest`. This is a different update from `wekyt update`, which updates the team. |
| `wekyt --version` | Show CLI version, install method (npm, curl, or local) and channel. |
| `wekyt doctor` | Check Node >= 22.12, curl, tar, the installed team, and update state. |
| `wekyt uninstall` | Remove `./ai/`, with confirmation unless `--yes`. Nothing outside `ai/` is touched. |

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

```bash
npm install
npm run build    # esbuild bundles src/cli.tsx into dist/wekyt.js, one file
npm test         # CLI integration tests, tools validation tests, TUI tests
npm run typecheck
npm run tools:validate          # validate ai/tools/*.yaml
npm run tools:generate          # validate and regenerate tools.json and the permissions matrix
```

The bundle is ESM in a single file. Ink 8 needs top-level await, so a CJS bundle is not possible; the `signal-exit` CJS entry is aliased to a minimal shim in `src/lib/signal-exit-shim.mjs` because esbuild cannot bundle its `require('assert')` into ESM output, and the bundle defines `require` through `createRequire` for the remaining CJS dependencies that call it at runtime. Both workarounds are commented where they live.

Publishing the package is a separate, manual step done by the main agent in the browser. See `PUBLISHING.md`.
