import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FieldCaptureRow } from '../FieldCaptureRow';

// FieldCaptureRow is the credential forms' own label + input + error row. The
// shared FormField wires hint, help text and required state to assistive tech;
// this row only described the error, so a screen reader never heard the hint
// ("paste the key from step 2"), the help text, or that the field is required.

function describedText(input: HTMLElement): string[] {
  const ids = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  return ids.map((id) => document.getElementById(id)?.textContent ?? `<missing #${id}>`);
}

describe('FieldCaptureRow accessibility contract', () => {
  it('describes the input by its hint and help text, and announces required', () => {
    render(
      <FieldCaptureRow
        source="schema"
        mode="editable"
        label="API Key"
        value=""
        onChange={() => {}}
        required
        hint="Paste the key from step 2"
        helpText="Starts with sk-"
        testIdBase="row"
      />,
    );
    const input = screen.getByTestId('row-input');
    expect(describedText(input)).toEqual(['Paste the key from step 2', 'Starts with sk-']);
    expect(input.getAttribute('aria-required')).toBe('true');
    expect(screen.getByLabelText(/API Key/)).toBe(input);
  });

  it('the error replaces the help text in the description, the hint stays', () => {
    render(
      <FieldCaptureRow
        source="schema"
        mode="editable"
        label="API Key"
        value=""
        onChange={() => {}}
        hint="Paste the key from step 2"
        helpText="Starts with sk-"
        error="API Key is required"
        testIdBase="row"
      />,
    );
    const input = screen.getByTestId('row-input');
    expect(describedText(input)).toEqual(['Paste the key from step 2', 'API Key is required']);
    expect(input.getAttribute('aria-invalid')).toBe('true');
  });

  it('two rows with the same label get distinct ids, each label bound to its own input', () => {
    render(
      <>
        <FieldCaptureRow source="auto" mode="editable" label="Token" value="a" onChange={() => {}} />
        <FieldCaptureRow source="auto" mode="editable" label="Token" value="b" onChange={() => {}} />
      </>,
    );
    const inputs = screen.getAllByLabelText('Token') as HTMLInputElement[];
    expect(inputs.map((i) => i.value)).toEqual(['a', 'b']);
    expect(new Set(inputs.map((i) => i.id)).size).toBe(2);
  });
});
