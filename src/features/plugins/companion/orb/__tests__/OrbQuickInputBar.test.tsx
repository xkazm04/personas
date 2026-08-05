import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrbQuickInputBar } from '../OrbQuickInputBar';
import { useCompanionStore } from '../../companionStore';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: {
        companion: {
          orb_quick_input_placeholder: 'Message Athena…',
          orb_quick_input_close: 'Close quick message',
          orb_quick_input_last_reply_label: "Athena's last reply",
          dictate_start: 'Dictate',
          dictate_stop: 'Stop dictation',
          send: 'Send',
        },
      },
    },
    tx: (s: string) => s,
  }),
}));

const dictationState = {
  supported: false,
  listening: false,
  finalText: '',
  interimText: '',
  error: null as string | null,
  start: vi.fn(),
  stop: vi.fn(),
  reset: vi.fn(),
};

vi.mock('../../useSpeechInput', () => ({
  useSpeechInput: () => dictationState,
}));

describe('OrbQuickInputBar', () => {
  beforeEach(() => {
    dictationState.supported = false;
    dictationState.listening = false;
    dictationState.finalText = '';
    dictationState.interimText = '';
    useCompanionStore.setState({ messages: [], streaming: false, voiceTurnRequest: null });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('submits typed text via setVoiceTurnRequest and clears the field', () => {
    render(<OrbQuickInputBar onClose={vi.fn()} />);
    const input = screen.getByTestId('orb-quick-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'quick hello' } });
    fireEvent.click(screen.getByTestId('orb-quick-input-send'));

    expect(useCompanionStore.getState().voiceTurnRequest).toBe('quick hello');
    expect(input.value).toBe('');
  });

  it('does not submit while a turn is already streaming', () => {
    useCompanionStore.setState({ streaming: true });
    render(<OrbQuickInputBar onClose={vi.fn()} />);
    const input = screen.getByTestId('orb-quick-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ignored while busy' } });
    expect(screen.getByTestId('orb-quick-input-send')).toBeDisabled();
    expect(useCompanionStore.getState().voiceTurnRequest).toBeNull();
  });

  it('shows the last assistant message above the input', () => {
    useCompanionStore.setState({
      messages: [
        { id: '1', role: 'user', content: 'hi', createdAt: '' },
        { id: '2', role: 'assistant', content: 'Here is my reply', createdAt: '' },
      ],
    });
    render(<OrbQuickInputBar onClose={vi.fn()} />);
    expect(screen.getByTestId('orb-quick-input-last-reply')).toHaveTextContent(
      'Here is my reply',
    );
  });

  it('omits the last-reply preview when there is no assistant message yet', () => {
    render(<OrbQuickInputBar onClose={vi.fn()} />);
    expect(screen.queryByTestId('orb-quick-input-last-reply')).toBeNull();
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<OrbQuickInputBar onClose={onClose} />);
    fireEvent.click(screen.getByTestId('orb-quick-input-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
