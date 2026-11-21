# Publishing the wekyt npm package

This document is for the main agent, who publishes by browser. The builder of the CLI does not create accounts and does not publish anything. Every step below needs a human decision or a browser session; nothing here is automated.

## 0. What is published

- Package name: `wekyt`, version `0.2.0`, from `~/workspace/wekyt-hub/cli/`.
- Contents: the single bundled file `dist/wekyt.js` (built with esbuild), plus `package.json` and `README.md`. The `files` field in `package.json` is `["dist"]`; npm always adds `package.json` and `README.md`.
- The name `wekyt` was verified free on npm on 2026-11-21 (404 on `https://registry.npmjs.org/wekyt`). Re-check it before creating anything, in case someone took it since.
- The package requires Node `>=22.12.0` (engines field). The bin is `wekyt`, pointing at `dist/wekyt.js`.

## 1. Create the npm account

1. In the browser, open https://www.npmjs.com/signup.
2. Create the account with the email the project uses for public publishing. Use a strong password, stored in the password manager, never in chat or in a file.
3. Verify the email address through the confirmation email npm sends.
4. Turn on two-factor authentication (2FA) for publishing: account settings, then 2FA. npm requires 2FA for publishing new packages in the default configuration. Keep the recovery codes in the password manager.
5. Decide the account name now: it is public and it is the publisher shown on the `wekyt` package page. Write it down in the release notes for v0.2.0.

Do not create the account from a script or from the terminal. The signup flow, the email verification and the 2FA setup all happen in the browser.

## 2. Prepare the package locally (no publish yet)

These steps run in the terminal, in `~/workspace/wekyt-hub/cli/`:

```bash
cd ~/workspace/wekyt-hub/cli
npm install
npm run typecheck
npm test
npm run build
npm pack --dry-run
```

Checks before publishing:

- `npm run typecheck` passes with no errors.
- `npm test` passes: 10 tests (CLI integration, tools validation, TUI).
- `npm pack --dry-run` lists exactly `dist/wekyt.js`, `package.json` and `README.md` (plus the default `LICENSE` if one is added). If it lists `node_modules`, `src`, `test` or `scripts`, stop: the `files` field is wrong.
- `dist/wekyt.js` starts with `#!/usr/bin/env node` and is executable.
- The version in `package.json` is `0.2.0` and the version in `~/workspace/wekyt-hub/ai/VERSION` is also `0.2.0`.

## 3. Log in to npm (browser flow, token in the terminal)

1. In the terminal, run `npm login`. It opens the browser for the npm login page.
2. Log in with the account from step 1 and approve the login in the browser. The terminal receives a token and stores it in `~/.npmrc`. Never print the token, never paste it in chat, never commit `~/.npmrc`.
3. Verify with `npm whoami`. It must print the account name from step 1.

If `npm login` cannot open the browser in this VM, use `npm login --auth-type=web` and open the printed URL by hand in the browser session.

## 4. Publish 0.2.0

```bash
cd ~/workspace/wekyt-hub/cli
npm publish --access public
```

Notes:

- The first publish of a name claims it. If it fails with 403, the name is taken or the account lacks the right: stop and re-check the name on https://www.npmjs.com/package/wekyt.
- If it fails with 402, the account needs a verified email or a payment method for the chosen plan: fix it in the browser, do not retry blindly.
- npm requires 2FA for publish when it is enabled: the terminal asks for the one-time code. Read it from the authenticator app, never from a file.
- After a successful publish, verify in the browser: https://www.npmjs.com/package/wekyt shows version 0.2.0, and `npm view wekyt dist-tags.latest` prints `0.2.0` in the terminal.

## 5. Tag the stable channel (later, not on day one)

The `stable` channel is an npm dist-tag, not a separate package. Do not tag 0.2.0 as stable on release day. The rule in the decision is: stable is a version one week older than latest with no major regressions.

When that week passes with no major regression:

```bash
npm dist-tag add wekyt@0.2.0 stable
npm view wekyt dist-tags
```

Expected output of the second command: `latest: 0.2.0` and `stable: 0.2.0`.

## 6. Publish the GitHub release v0.2.0 (same day as the npm publish)

The CLI installs the team from the GitHub release, so the npm publish alone is not enough. The release must carry the team package and its checksums, or `wekyt install` refuses it.

1. Build the package:

```bash
cd ~/workspace/wekyt-hub
cli/scripts/make-release-tarball.sh 0.2.0 dist
```

This writes `dist/wekyt-hub.tar.gz` and `dist/SHA256SUMS`.

2. In the browser, open https://github.com/wekyt/hub/releases/new.
3. Tag: `v0.2.0`. Title: `v0.2.0`. Notes: the CLI (`npx wekyt`), the TUI, the 14 tools as YAML files, and the two install paths. Mention that the release publishes `SHA256SUMS`, which v0.1.0 did not.
4. Upload two assets: `dist/wekyt-hub.tar.gz` and `dist/SHA256SUMS`. Both are required. Do not upload only the tarball: without `SHA256SUMS` the CLI refuses the install.
5. Publish the release.
6. Verify in a clean folder, in the terminal:

```bash
mkdir /tmp/wekyt-verify && cd /tmp/wekyt-verify
npx wekyt@0.2.0 --version
npx wekyt@0.2.0 install
npx wekyt@0.2.0 doctor
```

Expected: version `0.2.0`, install reports the team installed, doctor reports the team present with version `0.2.0`.

## 7. After publishing

- Tell the user the npm page URL and the release URL, with the exact version.
- Record the npm account name and the publish date in the hub repo (a short note in the release notes is enough). Never record the token.
- The next release bumps the version in three places together: `cli/package.json`, `cli/src/version.ts` (VERSION), and `ai/VERSION`. Then rebuild, retest, and repeat steps 2, 4 and 6.
