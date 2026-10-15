/**
 * "Why?" (mandate-lanes WP1): an option submits its value, Enter submits the
 * written reason (or skips it when nothing is typed and no minimum applies),
 * a minimum length blocks the write until met, Esc cancels. Digits picking an
 * option are the deck's keys and are proven in `deckSession.test.tsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { TriageReasonPrompt } from '@/features/agents/quick-answer/triage/triageTypes';
import { ReasonPrompt } from '../ReasonPrompt';

const withOptions: TriageReasonPrompt = {
  on: 'reject',
  title: 'Why reject?',
  options: [{ id: 'dup', label: 'Duplicate', value: 'duplicate' }, { id: 'scope', label: 'Out of scope', value: 'out-of-scope' }],
  skipLabel: 'Skip the reason',
  freeText: true,
};
const freeOnly: TriageReasonPrompt = { on: 'reject', title: 'Why send it back?', options: [], skipLabel: 'Back', freeText: true };

describe('ReasonPrompt', () => {
  it('prints a digit inside each option and submits its value on a click', () => {
    const onSubmit = vi.fn();
    render(<ReasonPrompt prompt={withOptions} min={0} onSubmit={onSubmit} onCancel={() => {}} />);
    const second = screen.getByRole('button', { name: /Out of scope/ });
    expect(second.querySelector('kbd')?.textContent).toBe('2');
    fireEvent.click(second);
    expect(onSubmit).toHaveBeenCalledWith('out-of-scope');
  });

  it('Enter submits the written reason, and an empty Enter skips it', () => {
    const onSubmit = vi.fn();
    render(<ReasonPrompt prompt={withOptions} min={0} onSubmit={onSubmit} onCancel={() => {}} />);
    const field = screen.getByRole('textbox', { name: 'Why reject?' });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenLastCalledWith(undefined);
    fireEvent.change(field, { target: { value: '  not now  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenLastCalledWith('not now');
  });

  it('Shift+Enter breaks the line instead of submitting', () => {
    const onSubmit = vi.fn();
    render(<ReasonPrompt prompt={withOptions} min={0} onSubmit={onSubmit} onCancel={() => {}} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a minimum length blocks the write and counts what is missing', () => {
    const onSubmit = vi.fn();
    render(<ReasonPrompt prompt={freeOnly} min={12} onSubmit={onSubmit} onCancel={() => {}} />);
    const field = screen.getByRole('textbox', { name: 'Why send it back?' });
    expect(document.activeElement).toBe(field);
    fireEvent.change(field, { target: { value: 'too short' } });
    expect(screen.getByText('3 more characters needed')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'The claim is unsupported.' } });
    expect(screen.getByText(/^Ready\./)).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('The claim is unsupported.');
  });

  it('Esc in the field cancels', () => {
    const onCancel = vi.fn();
    render(<ReasonPrompt prompt={freeOnly} min={0} onSubmit={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
