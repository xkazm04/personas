import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HelpSection } from '../NegotiatorStepCardHelpers';

/**
 * The Ask button is disabled while a help answer is loading, but Enter in the
 * question field called the same handler with no such check, so a second
 * (billed) help request could start while the first was in flight. Enter that
 * confirms an IME composition (CJK input) also submitted a half-typed question.
 */

function open(isLoadingHelp: boolean) {
  const onRequestHelp = vi.fn();
  render(<HelpSection stepIndex={0} onRequestHelp={onRequestHelp} stepHelp={null} isLoadingHelp={isLoadingHelp} />);
  fireEvent.click(screen.getByTestId('negotiator-step-0-help-toggle-btn'));
  const input = screen.getByTestId('negotiator-step-0-help-input');
  fireEvent.change(input, { target: { value: 'where is the token page?' } });
  return { input, onRequestHelp };
}

describe('HelpSection - Enter obeys the same gate as the Ask button', () => {
  it('asks on Enter when idle', () => {
    const { input, onRequestHelp } = open(false);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRequestHelp).toHaveBeenCalledWith('where is the token page?');
  });

  it('does not ask again on Enter while an answer is loading', () => {
    const { input, onRequestHelp } = open(true);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRequestHelp).not.toHaveBeenCalled();
  });

  it('does not ask on the Enter that ends an IME composition', () => {
    const { input, onRequestHelp } = open(false);
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(onRequestHelp).not.toHaveBeenCalled();
  });
});
