/**
 * The review's "Execution" link opens THAT execution.
 *
 * Its title promised "Execution <id>" but the click only switched the sidebar
 * to the Overview root, dropping `execution_id`. It now hands the id to the
 * Activity list's `pendingExecutionFocus` door.
 */
import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/overview/reviews', () => ({
  listReviewMessages: vi.fn().mockResolvedValue([]),
  addReviewMessage: vi.fn(),
}));
vi.mock('@/hooks/realtime/useReviewMessageAddedListener', () => ({
  useReviewMessageAddedListener: () => undefined,
}));

import { ConversationThread } from '../ReviewDetailPanel';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import type { ManualReviewItem } from '@/lib/types/types';

const review: ManualReviewItem = {
  id: 'rev-1',
  persona_id: 'p-1',
  execution_id: 'ex-1234567890',
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
  useOverviewStore.setState({ pendingExecutionFocus: null } as never);
  useSystemStore.setState({ sidebarSection: 'credentials' } as never);
});

function renderThread(r: ManualReviewItem) {
  render(<ConversationThread review={r} onAction={vi.fn().mockResolvedValue(undefined)} isProcessing={false} />);
  return document.querySelector('button[title^="Execution"], button[title="View executions"]') as HTMLButtonElement;
}

describe('ConversationThread execution link', () => {
  it('focuses the review execution in the Activity list', () => {
    fireEvent.click(renderThread(review));
    expect(useOverviewStore.getState().pendingExecutionFocus).toBe('ex-1234567890');
    expect(useOverviewStore.getState().overviewTab).toBe('executions');
    expect(useSystemStore.getState().sidebarSection).toBe('overview');
  });

  it('falls back to the Overview root when the review has no execution', () => {
    fireEvent.click(renderThread({ ...review, execution_id: null as never }));
    expect(useOverviewStore.getState().pendingExecutionFocus).toBeNull();
    expect(useSystemStore.getState().sidebarSection).toBe('overview');
  });
});
