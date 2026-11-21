# Publishing the wekyt npm package

This document is for the main agent, who publishes by browser. The builder of the CLI does not create accounts and does not publish anything. Every step below needs a human decision or a browser session; nothing here is automated.

## 0. What is published

- Package name: `wekyt`, version `0.2.2`, from `~/workspace/wekyt-hub/cli/`.
- Contents: the single bundled file `dist/wekyt.js` (built with esbuild), plus `package.json` and `README.md`. The `files` field in `package.json` is `["dist"]`; npm always adds `package.json` and `README.md`.
- The package requires Node `>=22.12.0` (engines field). The bin is `wekyt`, pointing at `dist/wekyt.js`.
- The npm account is `wekyt`, created 2026-11-21, email soportemailapps@gmail.com, 2FA enabled with a security key. The package https://www.npmjs.com/package/wekyt already exists at 0.2.0.

## 1. The publish path: Trusted Publishing (primary)

Publishing goes through the GitHub Actions workflow `.github/workflows/publish.yml`, using npm Trusted Publishing (OIDC). The package page has a trusted publisher configured: GitHub Actions, org wekyt, repo hub, workflow `publish.yml`, with `npm publish` allowed. A trusted publisher configuration must complete its first successful publish within 2 days of being created, or it expires.

The workflow runs on `workflow_dispatch` (branch main) and does: checkout, setup-node v6 with Node 24, setup pnpm, `pnpm install --frozen-lockfile`, `pnpm build`, `pnpm test`, `pnpm publish --access public --provenance`. No token and no 2FA prompt: the OIDC token from the workflow is the credential.

To publish a version:

1. Bump the version in three places together: `cli/package.json`, `cli/src/version.ts` (VERSION), and `ai/VERSION`.
2. Rebuild and retest locally (section 2).
3. Commit and push the changes to wekyt/hub main. The GitHub connector cannot create or modify workflow files; the workflow file itself does not change per release.
4. In the browser, open https://github.com/wekyt/hub/actions/workflows/publish.yml, click "Run workflow", branch main, and confirm.
5. Wait for the run to finish. If it fails, read the failing step: `pnpm install --frozen-lockfile` fails when `package.json` and `pnpm-lock.yaml` are out of sync; regenerate the lockfile with `pnpm install` and commit it.
6. Verify in the terminal: `npm view wekyt dist-tags.latest` prints the new version, and https://www.npmjs.com/package/wekyt shows it.
7. Publish the GitHub release (section 4) and verify in a clean folder (section 4, step 6).

## 2. Prepare the package locally (no publish yet)

This project uses pnpm (pinned in `package.json` as `packageManager`). These steps run in the terminal, in `~/workspace/wekyt-hub/cli/`:

```bash
cd ~/workspace/wekyt-hub/cli
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack --dry-run
```

Checks before publishing:

- `pnpm typecheck` passes with no errors.
- `pnpm test` passes: 12 tests (CLI integration, tools validation, TUI).
- `pnpm pack --dry-run` lists exactly `dist/wekyt.js`, `package.json` and `README.md` (plus the default `LICENSE` if one is added). If it lists `node_modules`, `src`, `test` or `scripts`, stop: the `files` field is wrong.
- `dist/wekyt.js` starts with `#!/usr/bin/env node` and is executable.
- The version in `package.json` is `0.2.2`, the version in `cli/src/version.ts` is `0.2.2`, and the version in `~/workspace/wekyt-hub/ai/VERSION` is also `0.2.2`.

## 3. Fallback: stage publish, then approve on the website

Use this only when the workflow path is unavailable. It needs the npm token stored in the vault (connector custom.npm, a granular token with read and write, All Packages, bypass 2FA). The token cannot publish directly or approve: it is rejected with 403 policy_denied on those calls. It can stage.

1. Build the package (section 2), then pack it: `pnpm pack` in `~/workspace/wekyt-hub/cli/`.
2. Stage it with a buffered POST (the npm CLI streaming upload gets ECONNRESET through this VM egress; a Python script that builds libnpmpublish's exact payload with Content-Length works). The script is recreated per session; it posts the manifest plus the tarball as a base64 attachment to `/-/stage/package/wekyt` with the vault token as Bearer. A success returns HTTP 201 with a `stageId`.
3. Verify with `npm stage view` (npx -y npm@latest, the system npm 10.9.4 is too old for stage commands).
4. The user approves the staged version on https://www.npmjs.com/package/wekyt in their own browser. Only a human with 2FA can approve; the token cannot.
5. Verify as in section 1, step 6, then publish the GitHub release (section 4).

Notes:

- `npm login` and `npm login --auth-type=web` do not work in this VM: the npm website's human check does not clear in the cloud browser. Do not retry it.
- A bypass-2FA granular token cannot configure Trusted Publishing either (`npm trust` returns 403 policy_denied). Trusted Publishing is configured on the package settings page in a real browser, by the user.
- If a publish fails with 403, the name is taken or the account lacks the right: stop and re-check the name on https://www.npmjs.com/package/wekyt.
- If it fails with 402, the account needs a verified email or a payment method for the chosen plan: fix it in the browser, do not retry blindly.

## 4. Publish the GitHub release v0.2.2 (same day as the npm publish)

The CLI installs the team from the GitHub release, so the npm publish alone is not enough. The release must carry the team package and its checksums, or `wekyt install` refuses it.

1. Build the package:

```bash
cd ~/workspace/wekyt-hub
cli/scripts/make-release-tarball.sh 0.2.2 dist
```

This writes `dist/wekyt-hub.tar.gz` and `dist/SHA256SUMS`.

2. In the browser, open https://github.com/wekyt/hub/releases/new.
3. Tag: `v0.2.2`. Title: `v0.2.2`. Notes: the CLI (`npx wekyt`), the TUI, the 14 tools as YAML files, the two install paths, the pnpm migration (lockfile, self-update with `pnpm add -g`, workflow on pnpm), and the agent safety rules (branch first, scope in the brief, secrets deny-list, pinned tool versions, no destructive operation without all four layers agreeing).
4. Upload two assets: `dist/wekyt-hub.tar.gz` and `dist/SHA256SUMS`. Both are required. Do not upload only the tarball: without `SHA256SUMS` the CLI refuses the install.
5. Publish the release.
6. Verify in a clean folder, in the terminal:

```bash
mkdir /tmp/wekyt-verify && cd /tmp/wekyt-verify
npx wekyt@0.2.2 --version
npx wekyt@0.2.2 install
npx wekyt@0.2.2 doctor
```

Expected: version `0.2.2`, install reports the team installed, doctor reports the team present with version `0.2.2`.

## 5. Tag the stable channel (later, not on day one)

The `stable` channel is an npm dist-tag, not a separate package. Do not tag 0.2.2 as stable on release day. The rule in the decision is: stable is a version one week older than latest with no major regressions.

When that week passes with no major regression:

```bash
npm dist-tag add wekyt@0.2.2 stable
npm view wekyt dist-tags
```

Expected output of the second command: `latest: 0.2.2` and `stable: 0.2.2`.

## 6. After publishing

- Tell the user the npm page URL and the release URL, with the exact version.
- Record the publish date in the hub repo (a short note in the release notes is enough). Never record the token.
- The next release bumps the version in three places together: `cli/package.json`, `cli/src/version.ts` (VERSION), and `ai/VERSION`. Then rebuild, retest, and repeat sections 1 and 4.
