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
    .option('--force', 'Replace an existing ai/ folder (also replaces CONTEXT.md and your skills)')
    .option('--tag <tag>', 'Install a pinned release, for example v0.2.0')
    .action(async (options: {force?: boolean; tag?: string}) => {
      const projectDir = resolveProject(program.opts());
      try {
        const r = await installTeam(projectDir, {force: options.force, tag: options.tag});
        console.log(`wekyt install: done. Team ${r.version}, ${r.files} files installed in ${path.join(projectDir, 'ai')}`);
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
        }
      } catch (e) {
        fail(e);
      }
    });

  program
    .command('doctor')
    .description('Check Node, curl, tar, the installed team, and update state')
    .action(() => {
      const projectDir = resolveProject(program.opts());
      const checks = doctor(projectDir);
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
    .command('uninstall')
    .description('Remove ./ai/ from this project. Nothing outside ai/ is touched')
    .option('--yes', 'Skip the confirmation prompt')
    .action(async (options: {yes?: boolean}) => {
      const projectDir = resolveProject(program.opts());
      if (installedVersion(projectDir) === null) {
        console.log('wekyt uninstall: no ai/ folder in this project.');
        return;
      }
      if (!options.yes) {
        const ok = await askConfirm(`Remove ${path.join(projectDir, 'ai')}?`);
        if (!ok) {
          console.log('wekyt uninstall: cancelled.');
          return;
        }
      }
      uninstallTeam(projectDir);
      console.log('wekyt uninstall: done. Removed ./ai/.');
    });

  await program.parseAsync(process.argv);
}

main().catch((e: unknown) => {
  if (e instanceof Error && e.message === 'unreachable') return;
  fail(e);
});
