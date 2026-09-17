/**
 * The card's own method: mount, complete a stub batch, unmount, remount the
 * same twin, and see the rows still there. The module-level cache test proves
 * the mechanism; this proves the WIRING, which is where the defect lived -
 * `rows` was `useState` and absorbing a batch clears the completion latch that
 * was the only other way back to it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const state: Record<string, unknown> = {};
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) => selector(state),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast: vi.fn() }),
}));
vi.mock('@/api/twin/twin', () => ({ simulateAnswer: vi.fn() }));

import TrainingStudio from '../TrainingStudio';
import { readStudioDraft, resetStudioDrafts } from '../studioDraftCache';

function seedStore(over: Record<string, unknown> = {}) {
  Object.assign(state, {
    activeTwinId: 'twin-a',
    twinProfiles: [{ id: 'twin-a', training_directives: '' }],
    recordTwinInteraction: vi.fn(),
    updateTwinProfile: vi.fn(),
    setTwinTab: vi.fn(),
    studioJobActive: false,
    studioPhase: null,
    studioCompleted: 0,
    studioTotal: 0,
    studioBatch: null,
    studioJustCompleted: null,
    startStudioQuestions: vi.fn(),
    startStudioAnswers: vi.fn(),
    cancelStudio: vi.fn(),
    clearStudioCompletion: vi.fn(),
    ...over,
  });
}

describe('TrainingStudio board persistence', () => {
  beforeEach(() => {
    resetStudioDrafts();
    for (const k of Object.keys(state)) delete state[k];
  });

  it('a completed batch survives unmount and is back on remount', () => {
    const items = [
      { id: 'q1', question: 'What shaped your approach?', answer: '' },
      { id: 'q2', question: 'What do you refuse to do?', answer: '' },
    ];
    seedStore({
      studioBatch: { items },
      studioJustCompleted: { ts: 1, phase: 'questions' },
    });

    const first = render(<TrainingStudio onExit={() => {}} />);
    expect(readStudioDraft('twin-a')).toHaveLength(items.length);

    // The walk-away the product advertises.
    first.unmount();

    // The latch is cleared by absorbing, so a remount has only the cache left.
    seedStore({ studioBatch: null, studioJustCompleted: null });
    render(<TrainingStudio onExit={() => {}} />);
    for (const it of items) {
      expect(screen.getByDisplayValue(it.question)).toBeTruthy();
    }
  });

  it("remounting on twin B does not show twin A's board", () => {
    seedStore({
      studioBatch: { items: [{ id: 'q1', question: 'Twin A question', answer: '' }] },
      studioJustCompleted: { ts: 1, phase: 'questions' },
    });
    const first = render(<TrainingStudio onExit={() => {}} />);
    first.unmount();

    seedStore({
      activeTwinId: 'twin-b',
      twinProfiles: [{ id: 'twin-b', training_directives: '' }],
      studioBatch: null,
      studioJustCompleted: null,
    });
    render(<TrainingStudio onExit={() => {}} />);
    expect(screen.queryByDisplayValue('Twin A question')).toBeNull();
    expect(readStudioDraft('twin-a')).toHaveLength(1);
  });
});
