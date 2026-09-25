import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Composer } from '../Composer';
import { DEFAULT_CONVERSATION_ID, useAthenaStore } from '../athenaStore';

const noop = () => {};

function renderComposer() {
  return render(
    <Composer disabled={false} onSend={noop} onDailyBrief={noop} onAnalyzeFleet={noop} />,
  );
}

describe('Composer draft persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    useAthenaStore.setState({
      draftsByConversation: {},
      activeConversationId: DEFAULT_CONVERSATION_ID,
      pendingPrompt: null,
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('survives an unmount/remount of the composer (window close/reopen)', () => {
    const { unmount } = renderComposer();
    const textarea = screen.getByTestId('companion-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'unsent draft text' } });
    expect(textarea.value).toBe('unsent draft text');
    expect(useAthenaStore.getState().draftsByConversation[DEFAULT_CONVERSATION_ID]).toBe(
      'unsent draft text',
    );

    unmount();

    renderComposer();
    const reopened = screen.getByTestId('companion-composer') as HTMLTextAreaElement;
    expect(reopened.value).toBe('unsent draft text');
  });

  it('keeps drafts scoped per conversation', () => {
    const { unmount } = renderComposer();
    const textarea = screen.getByTestId('companion-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'draft for default thread' } });
    unmount();

    useAthenaStore.setState({ activeConversationId: 'other-thread' });
    renderComposer();
    const otherThreadTextarea = screen.getByTestId('companion-composer') as HTMLTextAreaElement;
    expect(otherThreadTextarea.value).toBe('');
    expect(useAthenaStore.getState().draftsByConversation[DEFAULT_CONVERSATION_ID]).toBe(
      'draft for default thread',
    );
  });

  it('clears the persisted draft once the message is sent', () => {
    renderComposer();
    const textarea = screen.getByTestId('companion-composer') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'ready to send' } });
    expect(useAthenaStore.getState().draftsByConversation[DEFAULT_CONVERSATION_ID]).toBe(
      'ready to send',
    );

    fireEvent.click(screen.getByTestId('companion-send'));

    expect(textarea.value).toBe('');
    expect(
      useAthenaStore.getState().draftsByConversation[DEFAULT_CONVERSATION_ID],
    ).toBeUndefined();
  });
});
