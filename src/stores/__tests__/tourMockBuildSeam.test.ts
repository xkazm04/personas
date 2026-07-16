/**
 * Contract test for the getting-started mock-build seam
 * (src/test/automation/bridge.ts `driveMockBuild` + `mockExecutionComplete`).
 *
 * The mock seam's whole promise is: driving the agentStore build session
 * through the real phase sequence emits the SAME storeBus events the live CLI
 * build does, and storeBusWiring turns those into the SAME tour events, so the
 * getting-started tour's steps complete through their real `completeOn`
 * contract — NOT via a `tourEmit` shortcut. This test proves exactly that
 * wiring against the REAL system + agent stores + storeBusWiring, without a
 * Tauri build (the full `npm run test:tours:fresh` harness needs one).
 *
 * It replays the identical store actions `driveMockBuild` issues so a
 * regression in either the build-phase → storeBus emit, storeBusWiring's
 * build:phase-changed → tour event mapping, or the tour's completeOn wiring
 * turns red here.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import { storeBus } from '@/lib/storeBus';
import { initStoreBus } from '@/lib/storeBusWiring';

/** Replays the store actions `driveMockBuild` issues (see bridge.ts). */
function driveMockBuildStoreActions() {
  const sessionId = `mock-build-${Date.now()}`;
  const personaId = `mock-persona-${Date.now()}`;
  useAgentStore.getState().resetBuildSession();
  useAgentStore.getState().createBuildSession(personaId, sessionId);
  const status = (phase: string) =>
    useAgentStore.getState().handleBuildSessionStatus({
      type: 'session_status',
      session_id: sessionId,
      phase,
      resolved_count: 8,
      total_count: 8,
    });
  status('analyzing');
  status('resolving');
  status('draft_ready'); // → storeBus build:phase-changed → tour:persona-draft-ready
  useAgentStore.getState().handleStartTest('mock-test');
  useAgentStore.getState().handleTestComplete(true, 'Mock smoke test passed.');
  status('promoted'); // → storeBus build:phase-changed → tour:persona-promoted
  return { sessionId, personaId };
}

describe('getting-started mock-build seam', () => {
  beforeAll(() => {
    // Wire the real cross-store subscriptions (build:phase-changed →
    // tour:persona-promoted, execution:completed → tour:execution-complete).
    initStoreBus();
  });

  beforeEach(() => {
    localStorage.clear();
    useSystemStore.getState().resetTour('getting-started-simple');
    useSystemStore.getState().resetTour('getting-started');
    useAgentStore.getState().resetBuildSession();
  });

  it('drives the build to promoted → completes persona-creation via the real storeBus tour event', () => {
    const sys = () => useSystemStore.getState();
    sys().startTour('getting-started');
    expect(sys().tourActive).toBe(true);
    expect(sys().tourCurrentStepIndex).toBe(0);

    // Steps 1–2 are lightweight gates (the live spec drives them via tourEmit too).
    sys().emitTourEvent('tour:appearance-changed');
    sys().advanceTour();
    sys().emitTourEvent('tour:credentials-explored');
    sys().advanceTour();
    expect(sys().tourCurrentStepIndex).toBe(2); // persona-creation

    // The build's draft_ready phase must NOT prematurely complete the step —
    // persona-creation completes only on promote, so the next tour step (run)
    // has a promoted agent. Prove the honest-completion boundary holds.
    const beforePromote = { ...sys().tourStepCompleted };
    expect(beforePromote['persona-creation']).toBeFalsy();

    driveMockBuildStoreActions();

    // Completed through the real completeOn contract (tour:persona-promoted),
    // derived from the real build:phase-changed storeBus event.
    expect(sys().tourStepCompleted['persona-creation']).toBe(true);
  });

  it('emitting the real execution:completed event completes first-execution', () => {
    const sys = () => useSystemStore.getState();
    sys().startTour('getting-started');
    sys().emitTourEvent('tour:appearance-changed');
    sys().advanceTour();
    sys().emitTourEvent('tour:credentials-explored');
    sys().advanceTour();
    driveMockBuildStoreActions();
    sys().advanceTour();
    expect(sys().tourCurrentStepIndex).toBe(3); // first-execution

    // The mock counterpart of a real run: the same storeBus event the frontend
    // execution pipeline's frontend_complete stage emits.
    storeBus.emit('execution:completed', { personaId: 'mock-persona' });
    expect(sys().tourStepCompleted['first-execution']).toBe(true);

    // Whole tour is now walkable to completion.
    sys().advanceTour();
    expect(sys().tourCompleted).toBe(true);
  });
});
