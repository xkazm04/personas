import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RefineChips } from '../RefineChips';

describe('RefineChips', () => {
  it('renders nothing when priorUserMessage is empty', () => {
    const onSend = vi.fn();
    const { container } = render(
      <RefineChips priorUserMessage="" onSend={onSend} disabled={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders three chips when prior user message is present', () => {
    const onSend = vi.fn();
    render(
      <RefineChips
        priorUserMessage="What does this persona do?"
        onSend={onSend}
        disabled={false}
      />,
    );
    expect(
      screen.getByTestId('companion-refine-chips'),
    ).toBeInTheDocument();
    // 3 chips: Shorter / More detail / Code only
    expect(screen.getByRole('button', { name: /Shorter/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /More detail/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Code only/ })).toBeInTheDocument();
  });

  it('calls onSend with the original message + Shorter suffix', () => {
    const onSend = vi.fn();
    render(
      <RefineChips
        priorUserMessage="What does this persona do?"
        onSend={onSend}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Shorter/ }));
    expect(onSend).toHaveBeenCalledTimes(1);
    const sent = onSend.mock.calls[0][0] as string;
    expect(sent).toMatch(/^What does this persona do\?/);
    expect(sent.length).toBeGreaterThan('What does this persona do?'.length);
    expect(sent.toLowerCase()).toMatch(/shorter/);
  });

  it('disables all chips when disabled=true', () => {
    const onSend = vi.fn();
    render(
      <RefineChips
        priorUserMessage="Anything"
        onSend={onSend}
        disabled={true}
      />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((b) => expect(b).toBeDisabled());
    // a disabled button should not fire onSend even if clicked
    fireEvent.click(buttons[0]);
    expect(onSend).not.toHaveBeenCalled();
  });
});
