// simulationMode — is this build drivable, and is the operator driving it?
//
// TWO SEPARATE FACTS, deliberately kept apart.
//
//   • `isTestBuild()` — whether this build's test-automation bridge is open.
//     It reads `window.__PERSONAS_TEST_MODE__`, injected before page JS by
//     `src-tauri/src/lib.rs`. That flag is set when PERSONAS_TEST_PORT names a
//     port AND when the app was compiled `--features test-automation` — which
//     is what `npm run tauri:dev:test` builds, and where nothing sets that env
//     var. A shipped installer sets neither, so the flag is absent and the
//     toggle below never renders.
//
//   • `useSimulationEnabled()` — whether the operator has switched the board
//     over to mock data. `setSimulation` refuses to turn it on outside a test
//     build, so the guard is structural rather than a render-time condition
//     somebody can forget at the next call site.
//
// THE ENABLED FLAG LIVES IN A MODULE STORE, not in the board's `useState`. The
// Monitor is an overlay that fully unmounts on close, and a simulation the
// operator switched on would otherwise be off again the next time they opened
// it — the same reason `useClaudeUsage` keeps its warm snapshot one file over.
// It is a one-way latch per toggle rather than a refcount, so no ownership
// bookkeeping is needed and a remount cannot clear it (see
// `docs/concepts/golden-paths/hmr-safe-singletons.md` for the discriminator).

import { useSyncExternalStore } from 'react';

/** The flag `lib.rs` injects into the page when the automation bridge is open. */
interface TestModeWindow {
  __PERSONAS_TEST_MODE__?: boolean;
}

/**
 * True when this build carries the test-automation bridge — `tauri:dev:test`,
 * `launch-isolated`, or any debug build started with PERSONAS_TEST_PORT.
 * Read per call rather than captured at module load: the init script runs
 * before page JS, but a unit test may install the flag after import.
 */
export function isTestBuild(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as unknown as TestModeWindow).__PERSONAS_TEST_MODE__ === true;
}

let enabled = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getSnapshot = () => enabled;
/** SSR/prerender never has a bridge, so it never has a simulation either. */
const getServerSnapshot = () => false;

/**
 * Switch the simulated fleet on or off. Turning it ON is refused outside a
 * test build — the only way mock data can reach a real operator's board is if
 * this guard is absent, so it is here and not at the call site.
 */
export function setSimulation(next: boolean): void {
  const target = next && isTestBuild();
  if (target === enabled) return;
  enabled = target;
  for (const listener of listeners) listener();
}

export function toggleSimulation(): void {
  setSimulation(!enabled);
}

/** The flag, outside React. The hook below is what components should read. */
export function simulationEnabled(): boolean {
  return enabled;
}

export function useSimulationEnabled(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Test hatch — the flag is module state and outlives a component tree. */
export function _resetSimulationForTests(): void {
  enabled = false;
  listeners.clear();
}
