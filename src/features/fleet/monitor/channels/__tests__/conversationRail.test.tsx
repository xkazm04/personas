/**
 * The Conversations rail's one lamp: a held step needs the operator, so the
 * Reviews tab lights amber with the count while anything waits, and stays dark
 * (never "0") while the queue is unread or unreadable.
 */
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

let reported: number | null = null;
vi.mock('../ReviewsRail', () => ({
  ReviewsRail: ({ onCount }: { onCount?: (n: number | null) => void }) => {
    useEffect(() => onCount?.(reported), [onCount]);
    return <div data-testid="reviews-rail" />;
  },
}));
vi.mock('../DeliberationRail', () => ({ DeliberationRail: () => null }));
vi.mock('@/features/agents/quick-answer/QuickAnswerBody', () => ({ QuickAnswerBody: () => null }));

import { ConversationRail } from '../ConversationRail';

const members = [{ memberId: 'p1', personaId: 'p1', name: 'One', icon: null, color: null }];

function mount() {
  return render(
    <ConversationRail
      tab="reviews" onTab={() => undefined} scopeKey="t1" members={members as never}
      personaScoped={false} teamId="t1" focusDelib={null} railPersonaIds={new Set(['p1'])}
    />,
  );
}

describe('ConversationRail', () => {
  it('lights the Reviews lamp with the count while steps wait', () => {
    reported = 2;
    const { container } = mount();
    expect(screen.getByTestId('reviews-rail')).toBeTruthy();
    expect(container.querySelector('.ae-plate')).not.toBeNull();
    expect(container.querySelector('.ae-lamp.is-lit')).not.toBeNull();
    expect(screen.getByRole('tab', { name: /2/ })).toBeTruthy();
  });

  it('stays dark when nothing waits or the read failed', () => {
    for (const n of [0, null]) {
      reported = n;
      const { container, unmount } = mount();
      expect(container.querySelector('.ae-lamp.is-lit')).toBeNull();
      unmount();
    }
  });
});
