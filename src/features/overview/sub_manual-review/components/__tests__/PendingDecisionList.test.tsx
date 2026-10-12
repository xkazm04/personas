/**
 * Approvals › Pending after decision-center wave 3: the inline TriageFocus is
 * gone. "Decide N" opens the gates chip's queue in the global Decision Deck;
 * a row opens the same queue with that review on top. Selection (for the bulk
 * bar) stays a list act and opens nothing.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { closeDecisionDeck, useDecisionDeckStore } from '@/features/decision-center/deck/deckStore';
import type { ManualReviewItem } from '@/lib/types/types';

import { PendingDecisionList } from '../PendingDecisionList';

function review(id: string): ManualReviewItem {
  return {
    id,
    persona_id: 'p1',
    execution_id: `exec-${id}`,
    review_type: 'warning',
    content: `Approve ${id}?`,
    severity: 'warning',
    status: 'pending',
    reviewer_notes: null,
    context_data: null,
    suggested_actions: null,
    title: `Approve ${id}?`,
    created_at: '2026-10-01T10:00:00Z',
    resolved_at: null,
    persona_name: 'Scout',
  };
}

// New `overview.dc_*` copy reaches the lazily loaded section only after the
// Director re-splits the locales, so these tests pin behaviour, not wording.

afterEach(() => act(() => closeDecisionDeck()));

function renderList(onToggleSelect = vi.fn()) {
  render(
    <PendingDecisionList
      reviews={[review('r1'), review('r2')]}
      pendingTotal={5}
      selectedIds={new Set()}
      onToggleSelect={onToggleSelect}
    />,
  );
  return onToggleSelect;
}

describe('PendingDecisionList', () => {
  it('"Decide N" opens the gates queue from its most urgent card', () => {
    renderList();
    const decide = screen.getByTestId('pending-decide-all');
    expect(decide.dataset.count).toBe('5');
    fireEvent.click(decide);
    const req = useDecisionDeckStore.getState().request;
    expect(req?.scope).toEqual({ kind: 'chip', chip: 'gates' });
    expect(req?.focusId).toBeUndefined();
  });

  it('a row opens the gates queue with that review on top', () => {
    renderList();
    fireEvent.click(screen.getByText('Approve r2?'));
    const req = useDecisionDeckStore.getState().request;
    expect(req?.scope).toEqual({ kind: 'chip', chip: 'gates' });
    expect(req?.focusId).toBe('review:r2');
  });

  it('the checkbox selects for the bulk bar and opens no deck', () => {
    const onToggleSelect = renderList();
    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(onToggleSelect).toHaveBeenCalledWith('r1');
    expect(useDecisionDeckStore.getState().request).toBeNull();
  });
});
