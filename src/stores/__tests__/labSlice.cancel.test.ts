import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the lab API surface BEFORE importing the store. Each `start*`
// resolves with a fake run object so the lifecycle FSM transitions
// `idle → running`. Each `cancel*` resolves so the lifecycle's `finally`
// block can transition `running → cancelled`.
vi.mock('@/api/agents/lab', () => {
  const fakeRun = (id: string) => ({ id });
  return {
    labStartArena:       vi.fn().mockResolvedValue(fakeRun('arena-run')),
    labCancelArena:      vi.fn().mockResolvedValue(undefined),
    labStartAb:          vi.fn().mockResolvedValue(fakeRun('ab-run')),
    labCancelAb:         vi.fn().mockResolvedValue(undefined),
    labStartMatrix:      vi.fn().mockResolvedValue(fakeRun('matrix-run')),
    labCancelMatrix:     vi.fn().mockResolvedValue(undefined),
    labStartEval:        vi.fn().mockResolvedValue(fakeRun('eval-run')),
    labCancelEval:       vi.fn().mockResolvedValue(undefined),
    // Slice-creation references — never invoked by these tests.
    labListArenaRuns:    vi.fn(),
    labGetArenaResults:  vi.fn(),
    labDeleteArenaRun:   vi.fn(),
    labListAbRuns:       vi.fn(),
    labGetAbResults:     vi.fn(),
    labDeleteAbRun:      vi.fn(),
    labListMatrixRuns:   vi.fn(),
    labGetMatrixResults: vi.fn(),
    labDeleteMatrixRun:  vi.fn(),
    labAcceptDraft:      vi.fn(),
    labListEvalRuns:     vi.fn(),
    labGetEvalResults:   vi.fn(),
    labDeleteEvalRun:    vi.fn(),
    labGetRatings:       vi.fn(),
    labRateResult:       vi.fn(),
    labGetVersions:      vi.fn(),
    labTagVersion:       vi.fn(),
    labRollbackVersion:  vi.fn(),
    labGetErrorRate:     vi.fn(),
    labImprovePrompt:    vi.fn(),
    labGetActiveProgress: vi.fn().mockResolvedValue([]),
    labGetScoreWeights:  vi.fn().mockResolvedValue({ toolAccuracy: 0.4, outputQuality: 0.4, protocolCompliance: 0.2 }),
  };
});

import { useAgentStore } from '../agentStore';

describe('labSlice cancel*: per-mode lifecycle (regression for stuck flags)', () => {
  beforeEach(() => {
    // Reset the per-mode flags that tests below assert against. The lifecycle
    // FSM keeps its own internal state per-instance, so calling start* before
    // each test naturally lands the lifecycle in `running` regardless of
    // where it ended last time (start permits entry from any prior state).
    (useAgentStore as unknown as { setState: (s: Record<string, unknown>) => void }).setState({
      isArenaRunning: false,
      isAbRunning: false,
      isMatrixRunning: false,
      isEvalRunning: false,
      isLabRunning: false,
      arenaProgress: null,
      abProgress: null,
      matrixProgress: null,
      evalProgress: null,
      labProgress: null,
    });
  });

  it('cancelArena clears isArenaRunning (the mode-specific flag)', async () => {
    await useAgentStore.getState().startArena('p-1', []);
    expect(useAgentStore.getState().isArenaRunning).toBe(true);

    await useAgentStore.getState().cancelArena('arena-run');

    // Regression we're guarding against: cancelArena used to call
    // `labLifecycle.markCancelled` (legacy `isLabRunning`) instead of
    // the per-mode lifecycle, leaving `isArenaRunning` stuck at true
    // (cancel button stayed visible, launch button stayed disabled,
    // persona orbit dot never cleared until app restart).
    expect(useAgentStore.getState().isArenaRunning).toBe(false);
    expect(useAgentStore.getState().arenaProgress).toBeNull();
  });

  it('cancelMatrix clears isMatrixRunning (the mode-specific flag)', async () => {
    await useAgentStore.getState().startMatrix('p-1', 'do a thing', []);
    expect(useAgentStore.getState().isMatrixRunning).toBe(true);

    await useAgentStore.getState().cancelMatrix('matrix-run');

    expect(useAgentStore.getState().isMatrixRunning).toBe(false);
    expect(useAgentStore.getState().matrixProgress).toBeNull();
  });

  it('cancelAb clears isAbRunning (A/B owns its own per-mode lifecycle)', async () => {
    // A/B now has its OWN lifecycle (isAbRunning) — it no longer shares the
    // matrix flag, so cancelAb must reset isAbRunning and leave matrix alone.
    await useAgentStore.getState().startAb('p-1', 'vA', 'vB', []);
    expect(useAgentStore.getState().isAbRunning).toBe(true);

    await useAgentStore.getState().cancelAb('ab-run');

    expect(useAgentStore.getState().isAbRunning).toBe(false);
    expect(useAgentStore.getState().abProgress).toBeNull();
  });

  it('cancelEval clears isEvalRunning (Eval owns its own per-mode lifecycle)', async () => {
    await useAgentStore.getState().startEval('p-1', ['v1'], []);
    expect(useAgentStore.getState().isEvalRunning).toBe(true);

    await useAgentStore.getState().cancelEval('eval-run');

    expect(useAgentStore.getState().isEvalRunning).toBe(false);
    expect(useAgentStore.getState().evalProgress).toBeNull();
  });

  it('concurrent ab/matrix/eval runs keep independent running flags', async () => {
    // Start all three concurrently — each owns its own flag now.
    await useAgentStore.getState().startMatrix('p-1', 'do a thing', []);
    await useAgentStore.getState().startAb('p-1', 'vA', 'vB', []);
    await useAgentStore.getState().startEval('p-1', ['v1', 'v2'], []);
    expect(useAgentStore.getState().isMatrixRunning).toBe(true);
    expect(useAgentStore.getState().isAbRunning).toBe(true);
    expect(useAgentStore.getState().isEvalRunning).toBe(true);

    // Cancelling A/B must NOT clear Matrix's or Eval's running state.
    await useAgentStore.getState().cancelAb('ab-run');
    expect(useAgentStore.getState().isAbRunning).toBe(false);
    expect(useAgentStore.getState().isMatrixRunning).toBe(true);
    expect(useAgentStore.getState().isEvalRunning).toBe(true);
  });
});
