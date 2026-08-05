/**
 * The two legacy Quick Answer surfaces, and the three things they used to say
 * that were not true.
 *
 * `QuickAnswerBodyView` never destructured `loading` — the hook has always
 * returned it — so the green "You're all caught up" checkmark was rendered on
 * first paint, before a single fetch had landed, and again on a fetch that
 * FAILED, because a failed review load reached this view as an empty array and
 * nothing else.
 *
 * `QuickAnswerQuestionGroup` submitted inside a `try/finally` with no `catch`,
 * so a rejected answer became an unhandled rejection: no toast, no banner, the
 * button un-spun and the typed answers sat in the boxes looking exactly like a
 * successful send. The user found out when the persona never resumed.
 *
 * `QuickAnswerReviewStepper` fired its "Carrying out: …" success toast BEFORE
 * awaiting the dispatch, so a failed dispatch announced the run had started and
 * then, a beat later, that it had failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';

const mockAddToast = vi.fn();

vi.mock('@/stores/toastStore', () => ({
  useToastStore: { getState: () => ({ addToast: mockAddToast }) },
}));

import { QuickAnswerBodyView } from '../QuickAnswerBody';
import { QuickAnswerQuestionGroup } from '../QuickAnswerQuestionGroup';
import type { QuickAnswerData, QuestionGroup } from '../usePendingInteractions';

// This repo's test setup does not auto-cleanup.
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

function interactions(over: Partial<QuickAnswerData> = {}): QuickAnswerData {
  return {
    questionGroups: [],
    reviews: [],
    reviewsError: null,
    questionCount: 0,
    reviewCount: 0,
    total: 0,
    loading: false,
    isProcessing: false,
    submitQuestionAnswers: vi.fn().mockResolvedValue(undefined),
    handleReviewAction: vi.fn().mockResolvedValue(undefined),
    handleDispatchAction: vi.fn().mockResolvedValue(undefined),
    ...over,
  };
}

const group: QuestionGroup = {
  sessionId: 'sess-1',
  personaId: 'persona-1',
  personaName: 'Scribe',
  personaIcon: null,
  personaColor: null,
  questions: [{ cellKey: 'tools', question: 'Which tools?', options: null }],
};

describe('QuickAnswerBodyView tells loading, failed and empty apart', () => {
  it('does not claim you are caught up before the first fetch lands', () => {
    const { container } = render(
      <QuickAnswerBodyView interactions={interactions({ loading: true })} />,
    );

    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    // Once for the sr-only status, once visibly — the visible copy is
    // `aria-hidden` so it is not read out twice.
    expect(container.textContent).toContain('Reading what is waiting on you…');
    expect(screen.getByRole('status').textContent).toBe('Reading what is waiting on you…');
  });

  it('does not claim you are caught up when the read FAILED', () => {
    render(
      <QuickAnswerBodyView interactions={interactions({ reviewsError: 'db is locked' })} />,
    );

    expect(screen.queryByText("You're all caught up")).not.toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain('did not answer');
  });

  it('still says you are caught up when the queue is genuinely empty', () => {
    render(<QuickAnswerBodyView interactions={interactions()} />);
    expect(screen.getByText("You're all caught up")).toBeInTheDocument();
  });

  it('admits a partial failure over the half that DID load', () => {
    render(
      <QuickAnswerBodyView
        interactions={interactions({
          questionGroups: [group],
          questionCount: 1,
          total: 1,
          reviewsError: 'db is locked',
        })}
      />,
    );

    // The questions render — the reviewer is not blocked …
    expect(screen.getByTestId('quick-answer-group-sess-1')).toBeInTheDocument();
    // … and the missing half is still admitted.
    expect(screen.getByRole('status').textContent).toContain('did not answer');
  });
});

describe('a failed answer submission reaches the user', () => {
  it('toasts instead of becoming an unhandled rejection', async () => {
    const onSubmit = vi.fn().mockRejectedValue(new Error('the CLI is gone'));
    render(
      <QuickAnswerQuestionGroup
        group={group}
        busy={false}
        onSubmit={onSubmit}
        onOpenBuilder={vi.fn()}
      />,
    );

    const input = screen.getByTestId('quick-answer-input-tools');
    (input as HTMLInputElement).focus();
    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(input, { target: { value: 'ripgrep' } });
    fireEvent.click(screen.getByTestId('quick-answer-send-sess-1'));

    await waitFor(() => expect(mockAddToast).toHaveBeenCalled());
    expect(mockAddToast.mock.calls[0]![1]).toBe('error');
    // And the typed answer survives: the write never landed, so this is the
    // only copy of it that exists.
    expect((screen.getByTestId('quick-answer-input-tools') as HTMLInputElement).value).toBe(
      'ripgrep',
    );
  });

  it('clears the fields only when the write actually lands', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <QuickAnswerQuestionGroup
        group={group}
        busy={false}
        onSubmit={onSubmit}
        onOpenBuilder={vi.fn()}
      />,
    );

    const { fireEvent } = await import('@testing-library/react');
    fireEvent.change(screen.getByTestId('quick-answer-input-tools'), {
      target: { value: 'ripgrep' },
    });
    fireEvent.click(screen.getByTestId('quick-answer-send-sess-1'));

    await waitFor(() =>
      expect((screen.getByTestId('quick-answer-input-tools') as HTMLInputElement).value).toBe(''),
    );
    expect(mockAddToast).not.toHaveBeenCalled();
  });
});
