// Minimal on-exit handler with the same call shape as signal-exit 3.0.7.
//
// Why this file exists: esbuild cannot bundle signal-exit's CJS entry into
// an ESM bundle. Its `require('assert')` survives as a runtime require that
// throws "Dynamic require of assert is not supported" in ESM output.
// Ink 8 uses exactly one call: signalExit(handler, {alwaysLast: false}),
// and uses the returned function to unsubscribe. This shim implements
// only that contract: register a handler, run all handlers once when the
// process exits or receives a fatal signal, and remove a handler on
// unsubscribe. It is not a general replacement for signal-exit.
const handlers = new Set();
let installed = false;

function runAll(code) {
  for (const handler of [...handlers]) {
    try {
      handler(code, null);
    } catch {
      // A failing exit handler must not block the other handlers.
    }
  }
}

function install() {
  if (installed) return;
  installed = true;
  process.on('exit', (code) => runAll(code));
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']) {
    process.on(sig, () => {
      runAll(null);
      // Remove our own listeners so the default action terminates the
      // process with the same signal, as signal-exit does.
      process.removeAllListeners(sig);
      process.kill(process.pid, sig);
    });
  }
}

export default function onExit(handler, _opts) {
  install();
  handlers.add(handler);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    handlers.delete(handler);
  };
}
