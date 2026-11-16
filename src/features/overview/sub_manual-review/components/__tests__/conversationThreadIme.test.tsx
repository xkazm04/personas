/** Enter that commits an IME composition must not send the reply. */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addReviewMessage = vi.fn();
vi.mock('@/api/overview/reviews', () => ({
  listReviewMessages: vi.fn().mockResolvedValue([]),
  addReviewMessage: (...a: unknown[]) => addReviewMessage(...a),
}));
vi.mock('@/hooks/realtime/useReviewMessageAddedListener', () => ({
  useReviewMessageAddedListener: () => undefined,
}));

import { ConversationThread } from '../ReviewDetailPanel';
import type { ManualReviewItem } from '@/lib/types/types';

const review: ManualReviewItem = {
  id: 'rev-1',
  persona_id: 'p-1',
  execution_id: 'ex-1',
  review_type: 'warning',
  content: 'Approve the refund?',
  severity: 'warning',
  status: 'pending',
  reviewer_notes: null,
  context_data: null,
  suggested_actions: null,
  title: 'Refund',
  created_at: '2026-10-01T00:00:00Z',
  resolved_at: null,
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  addReviewMessage.mockReset();
});

describe('ConversationThread IME', () => {
  it('does not send on Enter while composing', () => {
    render(<ConversationThread review={review} onAction={vi.fn().mockResolvedValue(undefined)} isProcessing={false} />);
    const box = screen.getByRole('textbox');
    fireEvent.change(box, { target: { value: 'nihon' } });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    expect(addReviewMessage).not.toHaveBeenCalled();
  });
});
