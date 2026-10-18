import { describe, it, expect, beforeEach, vi } from 'vitest';

// Same lab API mock as src/stores/__tests__/labSlice.cancel.test.ts.
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

import * as labApi from '@/api/agents/lab';
import { useAgentStore } from '../../../agentStore';

type Setter = { setState: (s: Record<string, unknown>) => void };

function select(id: string | null) {
  (useAgentStore as unknown as Setter).setState({ selectedPersona: id ? { id } : null });
}

describe('labRunningPersonaIds tracks the persona that owns the run', () => {
  beforeEach(() => {
    (useAgentStore as unknown as Setter).setState({
      isArenaRunning: false, isAbRunning: false, isMatrixRunning: false, isEvalRunning: false,
      labRunningPersonaIds: [],
    });
    select(null);
  });

  it('clears the owner when its run ends while another persona is selected', async () => {
    select('p-owner');
    await useAgentStore.getState().startArena('p-owner', []);
    expect(useAgentStore.getState().labRunningPersonaIds).toEqual(['p-owner']);

    select('p-other');
    useAgentStore.getState().finishLabRun('arena');

    expect(useAgentStore.getState().labRunningPersonaIds).toEqual([]);
  });

  it('keeps the dot while the same persona still has another mode running', async () => {
    await useAgentStore.getState().startArena('p-1', []);
    await useAgentStore.getState().startEval('p-1', ['v1'], []);

    useAgentStore.getState().finishLabRun('arena');
    expect(useAgentStore.getState().labRunningPersonaIds).toEqual(['p-1']);

    useAgentStore.getState().finishLabRun('eval');
    expect(useAgentStore.getState().labRunningPersonaIds).toEqual([]);
  });

  it('lights the dot for a run recovered after a refresh', async () => {
    vi.mocked(labApi.labGetActiveProgress).mockResolvedValueOnce([
      { runId: 'm-1', mode: 'matrix', progress: { phase: 'executing' } },
    ] as unknown as Awaited<ReturnType<typeof labApi.labGetActiveProgress>>);
    await useAgentStore.getState().hydrateActiveProgress('p-rec');
    expect(useAgentStore.getState().labRunningPersonaIds).toEqual(['p-rec']);

    useAgentStore.getState().finishLabRun('matrix');
    expect(useAgentStore.getState().labRunningPersonaIds).toEqual([]);
  });
});
