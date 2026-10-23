import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormField } from '../FormField';

/** The ids an input's aria-describedby names, resolved to their text. */
function describedText(input: HTMLElement): string[] {
  const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? `<missing #${id}>`);
}

describe('FormField accessible wiring', () => {
  it('attaches the hint to the description chain, not only to the screen', () => {
    render(
      <FormField label="Host" hint="Letters and dashes only">
        {(p) => <input {...p} />}
      </FormField>,
    );
    expect(describedText(screen.getByRole('textbox'))).toEqual(['Letters and dashes only']);
  });

  it('reads the hint before the error once the error is visible', () => {
    render(
      <FormField label="Host" hint="Letters and dashes only" error="Host is required" validateOn="change">
        {(p) => <input {...p} />}
      </FormField>,
    );
    const input = screen.getByRole('textbox');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(describedText(input)).toEqual(['Letters and dashes only', 'Host is required']);
  });

  it('keeps the help text behind the hint when there is no error', () => {
    render(
      <FormField label="Host" hint="Letters and dashes only" helpText="Shown on the badge">
        {(p) => <input {...p} />}
      </FormField>,
    );
    expect(describedText(screen.getByRole('textbox'))).toEqual(['Letters and dashes only', 'Shown on the badge']);
  });

  it('exposes required as state, and keeps the asterisk out of the name', () => {
    render(
      <FormField label="Host" required>
        {(p) => <input {...p} />}
      </FormField>,
    );
    const input = screen.getByRole('textbox', { name: 'Host' });
    expect(input.getAttribute('aria-required')).toBe('true');
  });

  it('adds nothing when neither hint nor required is set', () => {
    render(
      <FormField label="Host">
        {(p) => <input {...p} />}
      </FormField>,
    );
    const input = screen.getByRole('textbox', { name: 'Host' });
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    expect(input.hasAttribute('aria-required')).toBe(false);
  });
});
