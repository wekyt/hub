import {Command, Option} from 'commander';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
import {render} from 'ink';
import React from 'react';
import {VERSION, type Channel} from './version';
import {WekytError} from './lib/util';
import {loadConfig} from './lib/config';
import {maybeCheckInBackground, printPendingNotice, runBackgroundCheck} from './lib/update-check';
import {
  checkTeamUpdate,
  detectInstallMethod,
  doctor,
  installTeam,
  installedVersion,
  statusLines,
  uninstallTeam,
  updateTeam,
  selfUpdateCli,
} from './lib/team';
import {generateRegistry, validateProject} from './lib/validate';
import {detectHarnesses, harnessInfo, initHarness, isHarness, type Harness} from './lib/harness';
import {listUserFiles} from './lib/manifest';
import {App} from './tui/App';

function fail(e: unknown): never {
  if (e instanceof WekytError) {
    console.error(`wekyt: error: ${e.message}`);
    if (e.fix) console.error(`wekyt: fix: ${e.fix}`);
    process.exitCode = 1;
  } else {
    console.error(`wekyt: error: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  }
  throw new Error('unreachable');
}

function resolveProject(options: {project?: string}): string {
  return options.project ? path.resolve(options.project) : process.cwd();
}

function askConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  return new Promise((resolve) => {
    rl.question(`${question} [y/N] `, (answer) => {
      rl.close();
      resolve(/^y(es)?$/i.test(answer.trim()));
    });
  });
}

function printMergeSummary(r: {preserved: string[]; bak: string[]}): void {
  if (r.preserved.length > 0) {
    console.log(`wekyt: kept ${r.preserved.length} of your own file(s) untouched: ${r.preserved.slice(0, 5).join(', ')}${r.preserved.length > 5 ? ', ...' : ''}`);
  }
  if (r.bak.length > 0) {
    console.log(`wekyt: your modified team file(s) were saved as .bak next to the new version: ${r.bak.join(', ')}`);
  }
}

async function pickHarnessInteractively(detected: {id: Harness; available: boolean; detail: string}[]): Promise<Harness | null> {
  const available = detected.filter((d) => d.available);
  if (available.length === 0) {
    console.error('wekyt init: no harness detected on this machine (looked for claude, gemini and codex on PATH, and a .cursor/ folder).');
    console.error('wekyt init: install one of them first, or pass --harness <name> anyway.');
    return null;
  }
  console.log('Detected harnesses:');
  available.forEach((d, i) => console.log(`  ${i + 1}. ${harnessInfo(d.id).label} (${d.detail})`));
  const rl = readline.createInterface({input: process.stdin, output: process.stdout});
  const answer = await new Promise<string>((resolve) => {
    rl.question(`Pick a harness [1-${available.length}] `, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });
  const n = parseInt(answer, 10);
  if (Number.isNaN(n) || n < 1 || n > available.length) {
    console.error('wekyt init: invalid choice.');
    return null;
  }
  return available[n - 1].id;
}

async function main(): Promise<void> {
  // Hidden entry point for the detached background version check.
  if (process.argv[2] === '__background-check') {
    await runBackgroundCheck();
    return;
  }

  printPendingNotice();
  maybeCheckInBackground();

  const program = new Command();
  program
    .name('wekyt')
    .description('Agent teams that build, maintain, and support software. Zero humans in the loop.')
    .version(`wekyt ${VERSION} (${detectInstallMethod()}, channel ${loadConfig().autoUpdatesChannel})`, '-V, --version', 'Show the wekyt version, install method and channel')
    .option('--project <dir>', 'Run in another project directory')
    .action(async (_options, command: Command) => {
      // No subcommand: open the TUI.
      const opts = program.opts<{project?: string}>();
      const projectDir = resolveProject(opts);
      if (!process.stdin.isTTY || !process.stdout.isTTY) {
        console.error('wekyt: the TUI needs an interactive terminal. Use `wekyt install`, `wekyt update` or `wekyt doctor` instead.');
        process.exitCode = 1;
        return;
      }
      const app = render(React.createElement(App, {projectDir}));
      await app.waitUntilExit();
    });

  const channelOption = new Option('--channel <channel>', 'Update channel').choices(['latest', 'stable']);

  program
    .command('install')
    .description('Install the dev team into ./ai/ from the latest GitHub release (SHA-256 verified)')
    .option('--force', 'Replace tracked team files (your own files are kept, modified team files are saved as .bak)')
    .option('--tag <tag>', 'Install a pinned release, for example v0.2.0')
    .action(async (options: {force?: boolean; tag?: string}) => {
      const projectDir = resolveProject(program.opts());
      try {
        const r = await installTeam(projectDir, {force: options.force, tag: options.tag});
        console.log(`wekyt install: done. Team ${r.version}, ${r.files} files installed in ${path.join(projectDir, 'ai')}`);
        printMergeSummary(r);
        console.log('wekyt install: next step: open this project with your agent harness and ask the orchestrator for the first job. See ai/README.md.');
      } catch (e) {
        fail(e);
      }
    });

  program
    .command('update')
    .description('Update the installed team (ai/). Use --self to update the CLI itself instead')
    .option('--check', 'Only show current version, latest version and channel, without downloading')
    .addOption(channelOption)
    .option('--rollback', 'Restore the previous saved copy of ai/')
    .option('--self', 'Update the wekyt CLI itself (npm install -g, or pnpm add -g when installed with pnpm)')
    .option('--tag <tag>', 'Update to a pinned release, for example v0.2.0')
    .action(async (options: {check?: boolean; channel?: Channel; rollback?: boolean; self?: boolean; tag?: string}) => {
      const projectDir = resolveProject(program.opts());
      try {
        if (options.self) {
          const channel: Channel = options.channel || loadConfig().autoUpdatesChannel;
          selfUpdateCli(channel);
          console.log(`wekyt update --self: done. Run \`wekyt --version\` to confirm the new version.`);
          return;
        }
        if (options.rollback) {
          const r = await updateTeam(projectDir, {rollback: true});
          console.log(`wekyt update --rollback: done. Restored team ${r.version} (${r.files} files in ./ai/).`);
          return;
        }
        if (options.check) {
          const channel: Channel = options.channel || loadConfig().autoUpdatesChannel;
          const result = await checkTeamUpdate(projectDir, channel);
          console.log(`current: ${result.current === null ? 'not installed' : result.current}`);
          console.log(`latest: ${result.latest}`);
          console.log(`channel: ${result.channel}`);
          console.log(result.upToDate ? 'status: up to date' : 'status: update available');
          return;
        }
        const before = installedVersion(projectDir);
        const r = await updateTeam(projectDir, {channel: options.channel, tag: options.tag});
        if (before === r.version) {
          console.log(`wekyt update: team is already up to date (${r.version}).`);
        } else {
          console.log(`wekyt update: done. Team ${before || 'none'} -> ${r.version} (${r.files} files in ./ai/). The previous copy is saved for rollback.`);
          printMergeSummary(r);
        }
      } catch (e) {
        fail(e);
      }
    });

  program
    .command('doctor')
    .description('Check Node, the installed team, its validation, the configured harness, and update state')
    .option('--json', 'Print the checks as JSON for scripts and CI')
    .action((options: {json?: boolean}) => {
      const projectDir = resolveProject(program.opts());
      const checks = doctor(projectDir);
      if (options.json) {
        const failed = checks.some((c) => !c.ok && c.severity === 'fail');
        console.log(JSON.stringify({ok: !failed, checks, status: statusLines(projectDir)}, null, 2));
        if (failed) process.exitCode = 1;
        return;
      }
      let failed = false;
      for (const c of checks) {
        const mark = c.ok ? 'ok' : c.severity === 'fail' ? 'FAIL' : 'warn';
        console.log(`${mark} ${c.name}: ${c.detail}`);
        if (c.fix) console.log(`     fix: ${c.fix}`);
        if (!c.ok && c.severity === 'fail') failed = true;
      }
      const lines = statusLines(projectDir);
      console.log('---');
      for (const line of lines) console.log(line);
      if (failed) process.exitCode = 1;
    });

  program
    .command('validate')
    .description('Validate ./ai/: tool definitions, permissions matrix, tools.json and your skills')
    .option('--json', 'Print the result as JSON for scripts and CI')
    .option('--generate', 'Regenerate tools.json and the permissions matrix from ai/tools/*.yaml')
    .action((options: {json?: boolean; generate?: boolean}) => {
      const projectDir = resolveProject(program.opts());
      try {
        if (options.generate) {
          const g = generateRegistry(projectDir);
          console.log(`wekyt validate: regenerated tools.json and permissions.md from ${g.tools} tool definitions.`);
          return;
        }
        const result = validateProject(projectDir);
        if (options.json) {
          console.log(JSON.stringify(result, null, 2));
        } else if (result.ok) {
          console.log(`wekyt validate: ok (${result.tools} tools, ${result.skills} skills, 0 errors).`);
        } else {
          console.error(`wekyt validate: failed (${result.errors.length} error${result.errors.length === 1 ? '' : 's'}):`);
          for (const e of result.errors) console.error(`  - ${e}`);
        }
        if (!result.ok) process.exitCode = 1;
      } catch (e) {
        fail(e);
      }
    });

  program
    .command('init')
    .description('Configure the harness that reads ./ai/ (writes ai/wekyt.config.json and a bridge file, never runs agents)')
    .option('--harness <name>', 'Harness to configure: claude, cursor, codex or gemini')
    .option('--force', 'Replace an existing ai/wekyt.config.json')
    .action(async (options: {harness?: string; force?: boolean}) => {
      const projectDir = resolveProject(program.opts());
      try {
        let harness: Harness | null = null;
        if (options.harness) {
          if (!isHarness(options.harness)) {
            throw new Error(`unknown harness ${options.harness}, use one of claude, cursor, codex, gemini.`);
          }
          harness = options.harness;
        } else if (process.stdin.isTTY) {
          harness = await pickHarnessInteractively(detectHarnesses(projectDir));
          if (harness === null) {
            process.exitCode = 1;
            return;
          }
        } else {
          const available = detectHarnesses(projectDir).filter((d) => d.available);
          if (available.length === 1) {
            harness = available[0].id;
          } else if (available.length === 0) {
            throw new Error('no harness detected on this machine, pass --harness <name> to configure one anyway.');
          } else {
            throw new Error(`more than one harness detected (${available.map((d) => d.id).join(', ')}), pass --harness <name> to pick one.`);
          }
        }
        const r = initHarness(projectDir, harness, {force: options.force});
        console.log(`wekyt init: done. Harness ${harness} written to ${r.configPath}.`);
        if (r.bridgeCreated) {
          console.log(`wekyt init: bridge file created at ${r.bridgePath}.`);
        } else {
          console.log(`wekyt init: bridge file ${r.bridgePath} already exists and was not modified. Add this snippet to it:`);
          console.log('---');
          console.log(r.snippet);
          console.log('---');
        }
      } catch (e) {
        fail(e);
      }
    });

  program
    .command('uninstall')
    .description('Remove ./ai/ from this project. Nothing outside ai/ is touched')
    .option('--yes', 'Skip the confirmation prompt')
    .action(async (options: {yes?: boolean}) => {
      const projectDir = resolveProject(program.opts());
      if (installedVersion(projectDir) === null) {
        console.log('wekyt uninstall: no ai/ folder in this project.');
        return;
      }
      const userFiles = listUserFiles(path.join(projectDir, 'ai'));
      if (!options.yes) {
        const extra = userFiles.length > 0 ? ` This also deletes ${userFiles.length} of your own file(s) in ai/ (not part of the team).` : '';
        const ok = await askConfirm(`Remove ${path.join(projectDir, 'ai')}?${extra}`);
        if (!ok) {
          console.log('wekyt uninstall: cancelled.');
          return;
        }
      } else if (userFiles.length > 0) {
        console.log(`wekyt uninstall: warning: this also deletes ${userFiles.length} of your own file(s) in ai/: ${userFiles.slice(0, 5).join(', ')}${userFiles.length > 5 ? ', ...' : ''}`);
      }
      const removed = uninstallTeam(projectDir);
      console.log(removed.removed ? 'wekyt uninstall: done. Removed ./ai/.' : 'wekyt uninstall: no ai/ folder to remove.');
    });

  await program.parseAsync(process.argv);
}

main().catch((e: unknown) => {
  if (e instanceof Error && e.message === 'unreachable') return;
  fail(e);
});
