import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChatInputBar, type ChatInputBarProps } from '../ChatInputBar';

function Harness(props: Partial<ChatInputBarProps> & { onSubmit: () => void }) {
  const [value, setValue] = useState(props.value ?? '');
  return (
    <ChatInputBar
      inputTestId="bar-input"
      sendTestId="bar-send"
      {...props}
      value={value}
      onChange={setValue}
    />
  );
}

describe('ChatInputBar', () => {
  it('submits on Enter and clears via the controlling harness', () => {
    const onSubmit = vi.fn();
    render(<Harness value="hello" onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByTestId('bar-input'), { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('submits on send-button click', () => {
    const onSubmit = vi.fn();
    render(<Harness value="hello" onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('bar-send'));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('disables the send button when the value is empty', () => {
    const onSubmit = vi.fn();
    render(<Harness value="" onSubmit={onSubmit} />);
    expect(screen.getByTestId('bar-send')).toBeDisabled();
  });

  it('disables input and send button when `disabled`', () => {
    const onSubmit = vi.fn();
    render(<Harness value="hello" onSubmit={onSubmit} disabled />);
    expect(screen.getByTestId('bar-input')).toBeDisabled();
    expect(screen.getByTestId('bar-send')).toBeDisabled();
  });

  it('omits the mic button when no `voice` prop is given (text-only)', () => {
    render(<Harness value="" onSubmit={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /mic/i })).toBeNull();
  });

  it('renders a mic toggle when `voice.supported` is true and calls onToggle', () => {
    const onToggle = vi.fn();
    render(
      <Harness
        value=""
        onSubmit={vi.fn()}
        voice={{
          supported: true,
          listening: false,
          onToggle,
          startLabel: 'Start dictation',
          listeningLabel: 'Stop dictation',
        }}
      />,
    );
    const mic = screen.getByRole('button', { name: 'Start dictation' });
    fireEvent.click(mic);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('hides the mic button when `voice.supported` is false', () => {
    render(
      <Harness
        value=""
        onSubmit={vi.fn()}
        voice={{
          supported: false,
          listening: false,
          onToggle: vi.fn(),
          startLabel: 'Start dictation',
          listeningLabel: 'Stop dictation',
        }}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Start dictation' })).toBeNull();
  });

  it('renders leading/trailing slot content', () => {
    render(
      <Harness
        value=""
        onSubmit={vi.fn()}
        leading={<span data-testid="leading-slot">L</span>}
        trailing={<span data-testid="trailing-slot">T</span>}
      />,
    );
    expect(screen.getByTestId('leading-slot')).toBeInTheDocument();
    expect(screen.getByTestId('trailing-slot')).toBeInTheDocument();
  });
});
