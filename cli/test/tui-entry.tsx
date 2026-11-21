// TUI test entry, bundled with esbuild and run by test/tui.test.mjs.
// It drives the real App with ink-testing-library: menu, arrow navigation,
// status screen, back to menu, and the replace confirmation.
import React from 'react';
import {render} from 'ink-testing-library';
import {App} from '../src/tui/App';

const projectDir = process.argv[2];
const mode = process.argv[3] || 'menu-status';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = [];

if (mode === 'menu-status') {
  const {lastFrame, stdin, unmount} = render(React.createElement(App, {projectDir}));
  await sleep(100);
  const menu = lastFrame();
  out.push(`menu renders: ${menu.includes('Instalar equipo') && menu.includes('Actualizar equipo') && menu.includes('Configurar harness') && menu.includes('Ver estado') && menu.includes('Actualizar CLI') && menu.includes('Salir') ? 'ok' : 'FAIL: ' + JSON.stringify(menu)}`);
  stdin.write('\x1B[B');
  await sleep(100);
  stdin.write('\x1B[B');
  await sleep(100);
  stdin.write('\x1B[B');
  await sleep(100);
  const moved = lastFrame();
  out.push(`arrow down moves selection: ${moved.includes('❯ Ver estado') ? 'ok' : 'FAIL: ' + JSON.stringify(moved)}`);
  stdin.write('\r');
  await sleep(200);
  const status = lastFrame();
  out.push(`status screen: ${status.includes('wekyt status') && /wekyt \d+\.\d+\.\d+/.test(status) ? 'ok' : 'FAIL: ' + JSON.stringify(status)}`);
  stdin.write('x');
  await sleep(100);
  const back = lastFrame();
  out.push(`back to menu: ${back.includes('Instalar equipo') ? 'ok' : 'FAIL: ' + JSON.stringify(back)}`);
  stdin.write('q');
  await sleep(100);
  unmount();
} else if (mode === 'init-none') {
  const {lastFrame, stdin, unmount} = render(React.createElement(App, {projectDir}));
  await sleep(100);
  stdin.write('\x1B[B');
  await sleep(100);
  stdin.write('\x1B[B');
  await sleep(100);
  const onInit = lastFrame();
  out.push(`init menu item: ${onInit.includes('❯ Configurar harness') ? 'ok' : 'FAIL: ' + JSON.stringify(onInit)}`);
  stdin.write('\r');
  await sleep(200);
  const done = lastFrame();
  out.push(`init with no harness detected: ${done.includes('No harness detected') ? 'ok' : 'FAIL: ' + JSON.stringify(done)}`);
  stdin.write('q');
  await sleep(100);
  unmount();
} else if (mode === 'confirm') {
  const {lastFrame, stdin, unmount} = render(React.createElement(App, {projectDir}));
  await sleep(100);
  stdin.write('\r');
  await sleep(200);
  const confirm = lastFrame();
  out.push(`replace confirm: ${confirm.includes('ai/ already exists') ? 'ok' : 'FAIL: ' + JSON.stringify(confirm)}`);
  stdin.write('\x1B[B');
  await sleep(100);
  stdin.write('\r');
  await sleep(100);
  const back = lastFrame();
  out.push(`confirm no returns to menu: ${back.includes('Instalar equipo') ? 'ok' : 'FAIL: ' + JSON.stringify(back)}`);
  unmount();
}

console.log(out.join('\n'));
if (out.some((l) => l.includes('FAIL'))) process.exitCode = 1;
