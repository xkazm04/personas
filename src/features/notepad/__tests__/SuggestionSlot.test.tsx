// Answering a question suggestion hands Athena a chat prompt AND marks the row
// accepted. The prompt used to be queued before the accept resolved, so a
// rejected write still injected the answer and a retry injected it twice.
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NoteSuggestion } from '../types';
import { SuggestionSlot } from '../parts/SuggestionSlot';

const { resolveNoteSuggestion, setPendingChatPrompt, refetchNote } = vi.hoisted(() => ({
  resolveNoteSuggestion: vi.fn(),
  setPendingChatPrompt: vi.fn(),
  refetchNote: vi.fn(),
}));

vi.mock('@/api/notepad', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/notepad')>();
  return { ...actual, resolveNoteSuggestion };
});

vi.mock('../notepadStore', () => ({ refetchNote }));

vi.mock('@/features/companions/athena/athenaStore', () => ({
  useAthenaStore: {
    getState: () => ({
      setPendingChatPrompt,
      chatCards: [],
      patchChatCardConfig: vi.fn(),
    }),
  },
}));

const question: NoteSuggestion = {
  cardId: 'c1',
  rowId: 'r1',
  kind: 'question',
  anchor: null,
  bodyMd: 'Why this shape?',
  outcome: null,
};

describe('SuggestionSlot — answering a question', () => {
  beforeEach(() => {
    resolveNoteSuggestion.mockReset();
    setPendingChatPrompt.mockReset();
    refetchNote.mockReset();
  });

  it('queues the chat prompt only after the row is accepted', async () => {
    let release: (row: { id: string }) => void = () => {};
    resolveNoteSuggestion.mockImplementation(
      () => new Promise((resolve) => {
        release = resolve;
      }),
    );
    render(<SuggestionSlot suggestions={[question]} />);

    fireEvent.change(screen.getByTestId('notepad-suggestion-answer-r1'), {
      target: { value: 'because the rail is the record' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    await waitFor(() => expect(resolveNoteSuggestion).toHaveBeenCalledTimes(1));
    expect(setPendingChatPrompt).not.toHaveBeenCalled();

    release({ id: 'n1' });
    await waitFor(() => expect(setPendingChatPrompt).toHaveBeenCalledTimes(1));
    expect(setPendingChatPrompt).toHaveBeenCalledWith({
      text: 'About the note suggestion "Why this shape?" — because the rail is the record',
      source: 'notepad',
    });
  });

  it('does not queue the chat prompt when the accept fails', async () => {
    resolveNoteSuggestion.mockRejectedValue(new Error('resolve down'));
    render(<SuggestionSlot suggestions={[question]} />);

    fireEvent.change(screen.getByTestId('notepad-suggestion-answer-r1'), {
      target: { value: 'because the rail is the record' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    await waitFor(() => expect(resolveNoteSuggestion).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(setPendingChatPrompt).not.toHaveBeenCalled());
    expect(refetchNote).not.toHaveBeenCalled();
  });
});
