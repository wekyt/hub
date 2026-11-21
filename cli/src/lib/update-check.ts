import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {VERSION} from '../version';
import {autoUpdateDisabled, loadNotice, loadState, saveNotice, saveState} from './config';
import {compareSemver} from './util';

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CHECK_TIMEOUT_MS = 3000;

/**
 * Background version check, gh and Homebrew pattern.
 * Runs at most once every 24 hours, in a detached child process, with a
 * 3 second timeout. It never blocks the command and never sends tokens,
 * paths or project data: it only reads public npm metadata for wekyt.
 * A newer version is reported on stderr on the next run, not this one,
 * because the child outlives the command that spawned it.
 */
export function maybeCheckInBackground(): void {
  if (autoUpdateDisabled()) return;
  if (process.argv.includes('__background-check')) return;
  const state = loadState();
  const last = state.lastCheck ? Date.parse(state.lastCheck) : 0;
  if (Date.now() - last < CHECK_INTERVAL_MS) return;
  try {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '__background-check'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
  } catch {
    // Background check is best effort. A failure here never fails the command.
  }
}

/** Print a pending update notice on stderr, once. Called at startup. */
export function printPendingNotice(): void {
  if (autoUpdateDisabled()) return;
  const notice = loadNotice();
  if (!notice || notice.seen) return;
  // Note: the decision text shows "Run 'wekyt update' to apply it", but
  // section 5 of the same decision says update (team) and update --self
  // (CLI) are two different updates that must never be confused. The
  // notice is about the CLI, so it names the self-update command.
  process.stderr.write(
    `Update available: wekyt ${notice.from} -> ${notice.to}. Run 'wekyt update --self' to apply it.\n`,
  );
  saveNotice({...notice, seen: true});
}

/** The detached background check. Fetches the npm dist-tag, writes state. */
export async function runBackgroundCheck(): Promise<void> {
  const started = new Date().toISOString();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CHECK_TIMEOUT_MS);
    try {
      const res = await fetch('https://registry.npmjs.org/wekyt', {signal: ctrl.signal});
      if (!res.ok) {
        // A 404 means the package is not published yet, not a network
        // failure. Record the check so we do not retry on every run.
        saveState({lastCheck: started});
        return;
      }
      const data = (await res.json()) as {['dist-tags']?: Record<string, string>};
      const latest = data['dist-tags']?.latest;
      if (!latest) return;
      saveState({lastCheck: started, latestKnown: latest});
      if (compareSemver(VERSION, latest) < 0) {
        saveNotice({from: VERSION, to: latest, seen: false, at: started});
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Network failure is swallowed silently, like gh does. The local
    // version keeps working, and the next run retries after 24 hours.
    try {
      saveState({lastCheck: started});
    } catch {
      // best effort
    }
  }
}

