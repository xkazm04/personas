import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';

import { mixWithEvidence } from '../../../journey/__tests__/detailFixtures';
import { renderLayer1 } from '../../layer1/__tests__/renderLayer1';
import { ProjectPlane } from '../../lens/planes/ProjectPlane';
import { __resetStepChunksForTests, STEP_INTENT_DELAY_MS, stepChunkRequested } from '../stepChunks';

// Opening a step should rarely wait: a pointer or focus resting on a step's
// column warms the screen's chunk, that step's preset chunk and its detail data.

/** The columns alone: the page would also drain every chunk in idle time, which is not what these tests count. */
function CollarView() {
  return <ProjectPlane litStepId={null} intro={false} onSelect={() => {}} />;
}

const getLifecycleStepDetail = vi.hoisted(() => vi.fn());
const getLifecycleHistory = vi.hoisted(() => vi.fn(async () => ({ measures: [], stepIds: ['gate', 'tests'] })));
vi.mock('@/api/devTools/lifecycle', () => ({ getLifecycleStepDetail, getLifecycleHistory }));

beforeEach(() => {
  vi.useFakeTimers();
  __resetStepChunksForTests();
  getLifecycleStepDetail.mockReset();
  getLifecycleStepDetail.mockImplementation(async (_p: string, stepId: string) => ({ stepId, runs: [], docs: [], related: [], evidence: [] }));
});

afterEach(() => {
  __resetStepChunksForTests();
  vi.useRealTimers();
});

describe('step intent prefetch', () => {
  it('requests the screen chunk, the preset chunk, the detail and the history after a short rest on a column', async () => {
    renderLayer1(<CollarView />, mixWithEvidence({ projectId: 'p-intent' }), null, { timeCursor: false });
    fireEvent.focus(screen.getByTestId('lens-col-gate'));
    // Not yet: intent needs a rest, so a sweep along the rail fetches nothing.
    expect(stepChunkRequested('screen')).toBe(false);
    expect(getLifecycleStepDetail).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(STEP_INTENT_DELAY_MS); });
    expect(stepChunkRequested('screen')).toBe(true);
    expect(stepChunkRequested('gate')).toBe(true);
    expect(stepChunkRequested('docs')).toBe(false);
    expect(getLifecycleStepDetail).toHaveBeenCalledWith('p-intent', 'gate');
    // Gate's screen draws the Measure history as a strip: its intent warms that too.
    await act(async () => { await Promise.resolve(); });
    expect(getLifecycleHistory).toHaveBeenCalledWith('p-intent');
  });

  it('drops an intent the pointer abandoned, and warms a snapshot-preset step detail too', async () => {
    renderLayer1(<CollarView />, mixWithEvidence({ projectId: 'p-sweep' }), null, { timeCursor: false });
    fireEvent.focus(screen.getByTestId('lens-col-tests'));
    fireEvent.blur(screen.getByTestId('lens-col-tests'));
    fireEvent.focus(screen.getByTestId('lens-col-land'));
    act(() => { vi.advanceTimersByTime(STEP_INTENT_DELAY_MS); });
    expect(stepChunkRequested('tests')).toBe(false);
    expect(stepChunkRequested('generic')).toBe(true);
    // Every screen reads its detail (backlog items and evidence behind Next); the abandoned step's is never asked.
    expect(getLifecycleStepDetail).toHaveBeenCalledTimes(1);
    expect(getLifecycleStepDetail).toHaveBeenCalledWith('p-sweep', 'land');
    await act(async () => { await Promise.resolve(); });
    expect(getLifecycleHistory).not.toHaveBeenCalledWith('p-sweep');
  });

  it('asks for a step detail once, however often the key is hovered', () => {
    renderLayer1(<CollarView />, mixWithEvidence({ projectId: 'p-dedupe' }), null, { timeCursor: false });
    for (let i = 0; i < 3; i++) {
      fireEvent.focus(screen.getByTestId('lens-col-docs'));
      act(() => { vi.advanceTimersByTime(STEP_INTENT_DELAY_MS); });
    }
    expect(getLifecycleStepDetail).toHaveBeenCalledTimes(1);
  });
});
