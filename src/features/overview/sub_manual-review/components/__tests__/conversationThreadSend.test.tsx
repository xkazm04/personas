/**
 * A reply that fails to land says so and keeps the draft.
 *
 * `handleSend` was try/finally with no catch: a failed `addReviewMessage` was
 * an unhandled rejection (Enter calls it un-awaited) and the reviewer saw the
 * Send button re-enable with no sign the reply never reached the thread.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useToastStore } from '@/stores/toastStore';

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

const addToast = vi.fn();
beforeEach(() => {
  // jsdom has no layout: the thread scrolls its tail into view on every message.
  Element.prototype.scrollIntoView = vi.fn();
  addToast.mockReset();
  addReviewMessage.mockReset();
  useToastStore.setState({ addToast } as never);
});

describe('ConversationThread — send failure', () => {
  it('toasts the failure and keeps the draft', async () => {
    addReviewMessage.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    render(<ConversationThread review={review} onAction={vi.fn().mockResolvedValue(undefined)} isProcessing={false} />);
    const box = screen.getByRole('textbox') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'please hold' } });
    await act(async () => {
      fireEvent.keyDown(box, { key: 'Enter' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(addReviewMessage).toHaveBeenCalledWith('rev-1', 'user', 'please hold');
    expect(addToast).toHaveBeenCalled();
    expect(addToast.mock.calls[0]![1]).toBe('error');
    expect(box.value).toBe('please hold');
  });
});
