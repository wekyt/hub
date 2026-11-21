# Test log, wekyt CLI v0.2.0

Date: 2026-11-21. VM: Node v24.22.1, npm 10.9.4. Every command below was run
in this VM, in temp folders, with a fresh HOME unless stated otherwise.

## Automated suite: npm test, 10 tests, 10 pass, 0 fail

Run in `~/workspace/wekyt-hub/cli` with `npm test`. Last run 2026-11-21:
10 tests, 10 pass, 0 fail.

- `wekyt --version` shows version, method and channel.
- `wekyt doctor` passes in an empty project.
- install, reinstall refusal, force reinstall, uninstall.
- install refuses a tarball with a bad checksum and installs nothing.
- install refuses a tarball with no checksums file.
- update to a newer local release and rollback restores the old team.
- validator passes on the real tool definitions.
- validator rejects readOnlyHint true with write effects.
- TUI menu, navigation, status screen and back (ink-testing-library).
- TUI install with existing ai/ asks for confirmation (ink-testing-library).

The CLI tests use a local tarball built from `ai/` plus a local SHA256SUMS
file, through the `WEKYT_TARBALL` and `WEKYT_SHA256SUMS` overrides, so they
need no network and no GitHub release.

## Clean room, workspace binary, temp HOME and project

Tarball built with `cli/scripts/make-release-tarball.sh 0.2.0 /tmp/wekyt-clean/dist`:

```text
built /tmp/wekyt-clean/dist/wekyt-hub.tar.gz (version 0.2.0)
b0859f60e90e8eb18d082b455af5c3721f5e6b9b71a2036943778f468e400957  wekyt-hub.tar.gz
```

With `WEKYT_TARBALL` and `WEKYT_SHA256SUMS` pointing at that package:

```text
$ wekyt install
wekyt install: done. Team 0.2.0, 29 files installed in /tmp/wekyt-clean/project/ai

$ wekyt --version
wekyt 0.2.0 (local, channel latest)

$ wekyt doctor
ok Node.js >= 22.12.0: Node 24.22.1
ok Tool: curl: found on PATH
ok Tool: tar: found on PATH
ok Team (./ai/): installed, version 0.2.0
ok Last update check: never checked
ok Last install/update attempt: ok at 2026-11-21T16:12:33.983Z
ok Auto-updates: disabled (WEKYT_NO_AUTO_UPDATE=1)
```

## Update check against the real GitHub release

No overrides, real network to `api.github.com/repos/wekyt/hub/releases/latest`:

```text
$ wekyt update --check
current: 0.2.0
latest: 0.1.0
channel: latest
status: up to date
```

Exit code 0. The latest published release is v0.1.0.

## Real v0.1.0 refuses install: no checksums file

In the first real-terminal run, the menu selection landed on update and ran
against the live v0.1.0 release. It downloaded the tarball (15.3 KB),
verified the hash, and refused, installing nothing:

```text
ok Download v0.1.0 (15.3 KB)
FAIL Verify SHA-256
Release v0.1.0 publishes no SHA256SUMS file, so the tarball cannot be verified.
Nothing was installed.
The release must publish a SHA256SUMS file (planned for v0.2.0).
```

This is the fail-closed behavior the decision requires.

## TUI in a real terminal (PTY via script)

Second run, keys sent one at a time with delays (down, down, Enter, x, q).
Exit code 0. The log shows the menu, the status screen with the doctor
report, the return to the menu, and a clean exit:

```text
wekyt status
  wekyt 0.2.0
  install method: local
  channel: latest
  team: ai/ installed, version 0.2.0, 29 files
  node: 24.22.1
doctor
  ok Node.js >= 22.12.0: Node 24.22.1
  ok Tool: curl: found on PATH
  ok Tool: tar: found on PATH
  ok Team (./ai/): installed, version 0.2.0
  ok Last update check: checked 2026-11-21T16:12:53.250Z
  ok Last install/update attempt: none recorded
  ok Auto-updates: disabled (WEKYT_NO_AUTO_UPDATE=1)
Press any key to go back.
```

Note: keys sent back to back in one write are coalesced by the terminal
into one step. The automated TUI test sends them with delays and checks
the selection indicator, and passes. The terminals named in the decision
(VS Code integrated, Ghostty, iTerm2, Windows Terminal) were not tested:
there is no such terminal in this VM, only the PTY above.

Bare `wekyt` with no TTY prints to stderr and exits 1:

```text
wekyt: the TUI needs an interactive terminal. Use `wekyt install`, `wekyt update` or `wekyt doctor` instead.
```

## Background version check

With a fresh HOME and no opt-out, one run wrote
`~/.wekyt/update-state.json` with `{"lastCheck": "2026-11-21T16:12:53.250Z"}`.
The registry returns 404 for `wekyt` (not published yet), so no notice was
written, and the check is not repeated within 24 hours.

## update --self before publishing

```text
$ wekyt update --self
wekyt: error: npm install -g wekyt@latest failed.
wekyt: fix: Check that the global npm directory is writable without sudo, and that the wekyt package is published. See cli/PUBLISHING.md.
```

Exit code 1. Expected until the package is published.

## Not tested here

- Install from the npm tarball with `npm install -g ./wekyt-0.2.0.tgz` in a
  clean folder: blocked in this run by a security check on the pack output.
  The same binary is covered by the tests above and by the clean-room run,
  but the global install path itself was not executed. It is the first step
  to run after the publish, from `cli/PUBLISHING.md` step 6.
- The TUI on VS Code integrated, Ghostty, iTerm2 and Windows Terminal: no
  such terminal exists in this VM. Only a PTY through `script` was tested.
- `wekyt update --channel stable`: no stable dist-tag exists yet, so the
  command reports that. The path is implemented and returns the
  NO_STABLE_CHANNEL error with the fix.
