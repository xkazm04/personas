import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { DictationState } from '../useDictation';

const browserStart = vi.fn();
const localStart = vi.fn();

function stubState(start: () => void): DictationState {
  return {
    supported: true,
    listening: false,
    finalText: '',
    interimText: '',
    error: null,
    start,
    stop: () => {},
    reset: () => {},
  };
}

vi.mock('../useDictation', () => ({
  useDictation: () => stubState(browserStart),
}));
vi.mock('../useLocalDictation', () => ({
  useLocalDictation: () => stubState(localStart),
}));

import { Composer } from '../Composer';
import { DEFAULT_CONVERSATION_ID, useAthenaStore } from '../athenaStore';
import { useSystemStore } from '@/stores/systemStore';

const noop = () => {};

function renderComposer() {
  return render(
    <Composer disabled={false} onSend={noop} onDailyBrief={noop} onAnalyzeFleet={noop} />,
  );
}

describe('Composer mic honours the selected STT engine', () => {
  beforeEach(() => {
    browserStart.mockClear();
    localStart.mockClear();
    localStorage.clear();
    useAthenaStore.setState({
      draftsByConversation: {},
      activeConversationId: DEFAULT_CONVERSATION_ID,
      pendingPrompt: null,
    });
  });

  it('starts the on-device engine when athenaSttEngine is whisper', () => {
    useSystemStore.setState({ athenaSttEngine: 'whisper' });
    renderComposer();
    fireEvent.click(screen.getByTestId('companion-mic'));
    expect(localStart).toHaveBeenCalledTimes(1);
    expect(browserStart).not.toHaveBeenCalled();
  });

  it('starts the browser engine when athenaSttEngine is browser', () => {
    useSystemStore.setState({ athenaSttEngine: 'browser' });
    renderComposer();
    fireEvent.click(screen.getByTestId('companion-mic'));
    expect(browserStart).toHaveBeenCalledTimes(1);
    expect(localStart).not.toHaveBeenCalled();
  });
});
