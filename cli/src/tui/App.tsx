import React, {useEffect, useState} from 'react';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {Box, Text, useApp, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import Spinner from 'ink-spinner';
import {
  doctor,
  detectInstallMethod,
  installTeam,
  installedVersion,
  statusLines,
  uninstallTeam,
  updateTeam,
  selfUpdateCli,
  type Step,
} from '../lib/team';
import {detectHarnesses, harnessInfo, initHarness, type Harness} from '../lib/harness';
import {listUserFiles} from '../lib/manifest';
import {VERSION, type Channel} from '../version';
import {loadConfig} from '../lib/config';
import {WekytError} from '../lib/util';

type Screen = 'menu' | 'progress' | 'status' | 'confirm' | 'done' | 'init-pick';
type Action = 'install' | 'update' | 'status' | 'self' | 'uninstall' | 'init' | 'exit';

const MENU_ITEMS = [
  {label: 'Instalar equipo', value: 'install' as Action},
  {label: 'Actualizar equipo', value: 'update' as Action},
  {label: 'Configurar harness', value: 'init' as Action},
  {label: 'Ver estado', value: 'status' as Action},
  {label: 'Actualizar CLI', value: 'self' as Action},
  {label: 'Desinstalar equipo', value: 'uninstall' as Action},
  {label: 'Salir', value: 'exit' as Action},
];

function renderError(e: unknown): string {
  if (e instanceof WekytError) {
    return `${e.message}${e.fix ? `\n${e.fix}` : ''}`;
  }
  return e instanceof Error ? e.message : String(e);
}

export function App({projectDir}: {projectDir: string}): React.ReactElement {
  const {exit} = useApp();
  const [screen, setScreen] = useState<Screen>('menu');
  const [action, setAction] = useState<Action | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmLabel, setConfirmLabel] = useState('');
  const [initChoices, setInitChoices] = useState<{label: string; value: Harness}[]>([]);
  const [pendingHarness, setPendingHarness] = useState<Harness | null>(null);

  useInput((input, key) => {
    if (screen === 'menu' && (input === 'q' || key.escape)) exit();
    if ((screen === 'done' || screen === 'status') && (input || key.return)) {
      setScreen('menu');
      setResult(null);
      setError(null);
    }
  });

  async function runAction(next: Action): Promise<void> {
    if (next === 'exit') {
      exit();
      return;
    }
    if (next === 'status') {
      setAction(next);
      setScreen('status');
      return;
    }
    if (next === 'init') {
      const detected = detectHarnesses(projectDir).filter((d) => d.available);
      if (detected.length === 0) {
        setAction(next);
        setError('No harness detected on this machine (looked for claude, gemini and codex on PATH, and a .cursor/ folder). Install one first, or use `wekyt init --harness <name>`.');
        setScreen('done');
        return;
      }
      setAction(next);
      setInitChoices(detected.map((d) => ({label: `${harnessInfo(d.id).label} (${d.detail})`, value: d.id})));
      setScreen('init-pick');
      return;
    }
    if (next === 'install' && installedVersion(projectDir) !== null) {
      setAction(next);
      setConfirmLabel('ai/ already exists. Replace the tracked team files? Your own files are kept, and modified team files are saved as .bak.');
      setScreen('confirm');
      return;
    }
    if (next === 'uninstall') {
      const userFiles = listUserFiles(`${projectDir}/ai`);
      setAction(next);
      setConfirmLabel(
        userFiles.length > 0
          ? `Remove ./ai/ from this project? This also deletes ${userFiles.length} of your own file(s) in ai/.`
          : 'Remove ./ai/ from this project? Nothing outside ai/ is touched.',
      );
      setScreen('confirm');
      return;
    }
    await execute(next, false);
  }

  async function execute(next: Action, force: boolean): Promise<void> {
    setAction(next);
    setError(null);
    setResult(null);
    setSteps([]);
    setScreen('progress');
    const onStep = (s: Step[]) => setSteps(s);
    try {
      if (next === 'install') {
        const r = await installTeam(projectDir, {force, onStep});
        setResult(`Installed team ${r.version} (${r.files} files in ./ai/).`);
      } else if (next === 'update') {
        const before = installedVersion(projectDir);
        const r = await updateTeam(projectDir, {onStep});
        setResult(
          before === r.version
            ? `Team is already up to date (${r.version}).`
            : `Updated team ${before || 'none'} -> ${r.version} (${r.files} files in ./ai/).`,
        );
      } else if (next === 'init') {
        const harness = pendingHarness;
        if (!harness) throw new Error('no harness selected.');
        const r = initHarness(projectDir, harness, {force});
        setResult(
          r.bridgeCreated
            ? `Harness ${harness} configured. Bridge file created at ${r.bridgePath}.`
            : `Harness ${harness} configured. Bridge file already exists and was not modified.`,
        );
      } else if (next === 'self') {
        const selfLabel = `Update CLI with ${detectInstallMethod() === 'pnpm' ? 'pnpm add -g' : 'npm install -g'} wekyt@latest`;
        setSteps([{label: selfLabel, state: 'running'}]);
        selfUpdateCli(loadConfig().autoUpdatesChannel as Channel);
        setSteps([{label: selfLabel, state: 'done'}]);
        setResult('CLI updated. Run `wekyt --version` to confirm the new version.');
      } else if (next === 'uninstall') {
        const removed = uninstallTeam(projectDir);
        setResult(removed.removed ? 'Removed ./ai/.' : 'No ./ai/ folder to remove.');
      }
      setScreen('done');
    } catch (e) {
      setSteps((prev) => prev.map((s) => (s.state === 'running' ? {...s, state: 'failed'} : s)));
      setError(renderError(e));
      setScreen('done');
    }
  }

  function pickHarness(harness: Harness): void {
    setPendingHarness(harness);
    if (installedVersion(projectDir) === null) {
      setError('No ai/ folder in this project. Install the team first.');
      setScreen('done');
      return;
    }
    if (fs.existsSync(path.join(projectDir, 'ai', 'wekyt.config.json'))) {
      setAction('init');
      setConfirmLabel('wekyt.config.json already exists. Replace it with the new harness?');
      setScreen('confirm');
      return;
    }
    void execute('init', false);
  }

  if (screen === 'status') {
    const checks = doctor(projectDir);
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {bold: true}, 'wekyt status'),
      ...statusLines(projectDir).map((line, i) => React.createElement(Text, {key: `s${i}`}, `  ${line}`)),
      React.createElement(Text, {bold: true}, 'doctor'),
      ...checks.map((c, i) =>
        React.createElement(Text, {key: `c${i}`}, `  ${c.ok ? 'ok' : c.severity === 'fail' ? 'FAIL' : 'warn'} ${c.name}: ${c.detail}`),
      ),
      React.createElement(Text, {dimColor: true}, 'Press any key to go back.'),
    );
  }

  if (screen === 'init-pick') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {bold: true}, 'Pick the harness that reads ./ai/'),
      React.createElement(SelectInput, {
        items: [...initChoices, {label: 'Cancel', value: 'cancel' as unknown as Harness}],
        onSelect: (item: {value: unknown}) => {
          if (item.value === 'cancel') {
            setScreen('menu');
          } else {
            pickHarness(item.value as Harness);
          }
        },
      }),
    );
  }

  if (screen === 'confirm') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {bold: true}, confirmLabel),
      React.createElement(SelectInput, {
        items: [
          {label: 'Yes', value: 'yes'},
          {label: 'No', value: 'no'},
        ],
        onSelect: (item: {value: unknown}) => {
          if (item.value === 'yes' && action) {
            void execute(action, true);
          } else {
            setScreen('menu');
          }
        },
      }),
    );
  }

  if (screen === 'progress' || screen === 'done') {
    return React.createElement(
      Box,
      {flexDirection: 'column'},
      React.createElement(Text, {bold: true}, `wekyt ${VERSION}`),
      ...steps.map((s, i) =>
        React.createElement(
          Box,
          {key: `p${i}`},
          s.state === 'running'
            ? React.createElement(Text, null, React.createElement(Spinner, {type: 'dots'}), ' ')
            : React.createElement(Text, null, s.state === 'done' ? 'ok ' : s.state === 'failed' ? 'FAIL ' : '... '),
          React.createElement(Text, null, `${s.label}${s.detail ? ` (${s.detail})` : ''}`),
        ),
      ),
      error ? React.createElement(Text, {color: 'red'}, error) : null,
      result ? React.createElement(Text, {color: 'green'}, result) : null,
      screen === 'done' ? React.createElement(Text, {dimColor: true}, 'Press any key to go back.') : null,
    );
  }

  return React.createElement(
    Box,
    {flexDirection: 'column'},
    React.createElement(Text, {bold: true}, `wekyt ${VERSION} - Agent teams that build, maintain, and support software.`),
    React.createElement(Text, {dimColor: true}, 'Use arrow keys and Enter. Press q or Esc to quit.'),
    React.createElement(SelectInput, {
      items: MENU_ITEMS,
      onSelect: (item: {label: string; value: unknown}) => {
        void runAction(item.value as Action);
      },
    }),
  );
}
