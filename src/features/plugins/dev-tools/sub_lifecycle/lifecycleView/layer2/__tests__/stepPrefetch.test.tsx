import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { mixWithEvidence } from '../../../journey/__tests__/detailFixtures';
import { Rail } from '../../layer1/rail/Rail';
import { useLayer1 } from '../../layer1/useLayer1';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { __resetStepChunksForTests, STEP_INTENT_DELAY_MS, stepChunkRequested } from '../stepChunks';

// Opening a step should rarely wait: a pointer or focus resting on a step's
// key warms the screen's chunk, that step's preset chunk and its detail data.

/** The rail alone: Layer 1 would also drain every chunk in idle time, which is not what these tests count. */
function CollarView() {
  return <Rail data={useLayer1()} />;
}

const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleStepDetail }));

beforeEach(() => {
  vi.useFakeTimers();
  __resetStepChunksForTests();
  getLifecycleStepDetail.mockReset();
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => ({ stepId, runs: [], docs: [] }));
});

afterEach(() => {
  __resetStepChunksForTests();
  vi.useRealTimers();
});

describe('step intent prefetch', () => {
  it('requests the screen chunk, the preset chunk and the detail after a short rest on a key', () => {
    renderLayer1(<CollarView />, mixWithEvidence({ projectId: 'p-intent' }));
    fireEvent.focus(screen.getByTestId('lc-node-gate'));
    // Not yet: intent needs a rest, so a sweep along the rail fetches nothing.
    expect(stepChunkRequested('screen')).toBe(false);
    expect(getLifecycleStepDetail).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(STEP_INTENT_DELAY_MS); });
    expect(stepChunkRequested('screen')).toBe(true);
    expect(stepChunkRequested('gate')).toBe(true);
    expect(stepChunkRequested('docs')).toBe(false);
    expect(getLifecycleStepDetail).toHaveBeenCalledWith('p-intent', 'gate');
  });

  it('drops an intent the pointer abandoned, and fetches no detail for a snapshot-only step', () => {
    renderLayer1(<CollarView />, mixWithEvidence({ projectId: 'p-sweep' }));
    fireEvent.focus(screen.getByTestId('lc-node-tests'));
    fireEvent.blur(screen.getByTestId('lc-node-tests'));
    fireEvent.focus(screen.getByTestId('lc-node-land'));
    act(() => { vi.advanceTimersByTime(STEP_INTENT_DELAY_MS); });
    expect(stepChunkRequested('tests')).toBe(false);
    expect(stepChunkRequested('generic')).toBe(true);
    expect(getLifecycleStepDetail).not.toHaveBeenCalled();
  });

  it('asks for a step detail once, however often the key is hovered', () => {
    renderLayer1(<CollarView />, mixWithEvidence({ projectId: 'p-dedupe' }));
    for (let i = 0; i < 3; i++) {
      fireEvent.focus(screen.getByTestId('lc-node-docs'));
      act(() => { vi.advanceTimersByTime(STEP_INTENT_DELAY_MS); });
    }
    expect(getLifecycleStepDetail).toHaveBeenCalledTimes(1);
  });
});
