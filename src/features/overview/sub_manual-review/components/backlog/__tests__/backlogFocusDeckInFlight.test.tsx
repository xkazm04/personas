/**
 * The focus deck decides one card at a time.
 *
 * The triage slice rewrites a row only after its write returns, so while a
 * verdict is in flight the top card is still the idea being decided. The deck's
 * keys and drags never consulted `busy`, so a second → re-decided the SAME idea
 * (a lost compare-and-swap, a "decided elsewhere" toast, a full reload) instead
 * of the next one; and `busy` never covered Build now's createTask, so a
 * double-click queued two implementation tasks for one idea.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const createTask = vi.fn();
vi.mock('@/api/devTools/devTools', () => ({
  createTask: (...a: unknown[]) => createTask(...a),
}));
// The card is presentation only; the deck's verdict wiring is under test.
vi.mock('../SwipeCard', () => ({ SwipeCard: () => null }));

import { BacklogFocusDeck } from '../BacklogFocusDeck';
import type { BacklogIdea } from '../backlogModel';

function idea(id: string): BacklogIdea {
  return {
    id, title: `Idea ${id}`, description: '', reasoning: '', category: 'performance',
    origin: null, scanType: 'code', projectId: 'p', projectName: 'P', effort: 3, impact: 8,
    risk: 2, priority: null, status: 'pending', evidence: null, verifyState: null,
    createdAt: '2026-02-01T00:00:00.000Z',
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => createTask.mockReset());

function renderDeck(onAccept: (id: string) => Promise<void>) {
  render(
    <BacklogFocusDeck
      rows={[idea('a'), idea('b')]}
      counts={null}
      categoryLabel={(k) => k}
      busy={false}
      onAccept={onAccept}
      onReject={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn().mockResolvedValue(undefined)}
    />,
  );
}

describe('BacklogFocusDeck — one verdict in flight', () => {
  it('a second → while the first accept is in flight does not re-decide the same idea', async () => {
    const gate = deferred();
    const onAccept = vi.fn().mockReturnValue(gate.promise);
    renderDeck(onAccept);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onAccept).toHaveBeenCalledTimes(1);
    await act(async () => { gate.resolve(); await gate.promise; });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(onAccept).toHaveBeenCalledTimes(2);
  });

  it('a double-click on Build now queues one task', async () => {
    const gate = deferred();
    createTask.mockReturnValue(gate.promise);
    renderDeck(vi.fn().mockResolvedValue(undefined));
    const build = screen.getAllByRole('button').find((b) => b.querySelector('.lucide-hammer'))!;
    fireEvent.click(build);
    fireEvent.click(build);
    await act(async () => { gate.resolve(); await gate.promise; });
    expect(createTask).toHaveBeenCalledTimes(1);
  });
});
