import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Minimal i18n mock: tx interpolates {count} so the title assertions are real.
// The specialized-control cases below render real ThemedSelect / DirectoryPicker
// / ColorPicker, so their keys live here too.
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      common: {
        form_error_summary_title_one: '{count} field needs your attention',
        form_error_summary_title_other: '{count} fields need your attention',
        browse: 'Browse',
        retry: 'Retry',
        select_directory: 'Select a directory...',
        select_output_directory: 'Select output directory',
        directory_browse_failed: 'The folder picker could not open.',
        recent_directories: 'Recent folders',
      },
      shared: {
        forms_extra: {
          color_hex_placeholder: '#8b5cf6',
          color_hex_invalid: 'Enter a hex colour',
        },
      },
    },
    tx: (s: string, vars: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')),
  }),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn().mockResolvedValue(null) }));

import { FormField } from '../FormField';
import { FormErrorProvider } from '../FormErrorContext';
import { FormErrorSummary } from '../FormErrorSummary';
import { ThemedSelect } from '../ThemedSelect';
import { DirectoryPickerInput } from '../DirectoryPickerInput';
import { ColorPicker } from '../ColorPicker';

function Field({ label, error }: { label: string; error?: string }) {
  return (
    <FormField label={label} error={error} validateOn="change">
      {(inputProps) => <input {...inputProps} />}
    </FormField>
  );
}

describe('FormErrorSummary', () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('renders nothing when there are no errors', () => {
    render(
      <FormErrorProvider>
        <FormErrorSummary />
        <Field label="Name" />
      </FormErrorProvider>,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('lists each visible field error and pluralizes the title', () => {
    render(
      <FormErrorProvider>
        <FormErrorSummary />
        <Field label="Name" error="Name is required" />
        <Field label="Email" error="Email is invalid" />
      </FormErrorProvider>,
    );

    // The banner role=alert wraps the summary.
    const alerts = screen.getAllByRole('alert');
    const summary = alerts.find((el) => el.textContent?.includes('need your attention'));
    expect(summary).toBeTruthy();
    expect(summary!.textContent).toContain('2 fields need your attention');

    expect(screen.getByRole('button', { name: /Name is required/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Email is invalid/ })).toBeInTheDocument();
  });

  it('jumps to the offending field: scrollIntoView + focus on click', () => {
    render(
      <FormErrorProvider>
        <FormErrorSummary />
        <Field label="Name" error="Name is required" />
      </FormErrorProvider>,
    );

    const jumpBtn = screen.getByRole('button', { name: /Name is required/ });
    const input = document.querySelector('input') as HTMLInputElement;
    const focusSpy = vi.spyOn(input, 'focus');

    fireEvent.click(jumpBtn);

    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: 'center',
      behavior: 'smooth',
    });
    expect(focusSpy).toHaveBeenCalled();
  });

  it('drops an error from the summary once it clears', () => {
    const { rerender } = render(
      <FormErrorProvider>
        <FormErrorSummary />
        <Field label="Name" error="Name is required" />
      </FormErrorProvider>,
    );
    expect(screen.getByRole('button', { name: /Name is required/ })).toBeInTheDocument();

    rerender(
      <FormErrorProvider>
        <FormErrorSummary />
        <Field label="Name" />
      </FormErrorProvider>,
    );
    expect(screen.queryByRole('button', { name: /Name is required/ })).not.toBeInTheDocument();
  });
});

// The point of this block: FormField's vocabulary (id / aria-invalid /
// aria-describedby / summary jump) has to reach the SPECIALIZED controls too,
// not just a bare <input>. Before these, every one of them dropped the props on
// the floor and a long form could list only its native fields.
describe('FormErrorSummary with specialized controls', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('lands the jump on a filterable ThemedSelect trigger', () => {
    render(
      <FormErrorProvider>
        <FormErrorSummary />
        <FormField label="Region" error="Pick a region" validateOn="change">
          {(p) => (
            <ThemedSelect
              {...p}
              filterable
              options={[{ value: 'eu', label: 'Europe' }]}
              value=""
              onValueChange={vi.fn()}
              aria-label="Region"
            />
          )}
        </FormField>
      </FormErrorProvider>,
    );

    const trigger = screen.getByRole('button', { name: 'Region' });
    expect(trigger.id).toMatch(/^ff-/);
    expect(trigger).toHaveAttribute('aria-invalid', 'true');
    expect(trigger.getAttribute('aria-describedby')).toBe(`${trigger.id}-err`);
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');

    const focusSpy = vi.spyOn(trigger, 'focus');
    fireEvent.click(screen.getByRole('button', { name: /Pick a region/ }));
    expect(focusSpy).toHaveBeenCalled();
  });

  it('lands the jump on the DirectoryPicker path input', () => {
    render(
      <FormErrorProvider>
        <FormErrorSummary />
        <FormField label="Workspace" error="Choose a folder" validateOn="change">
          {(p) => <DirectoryPickerInput {...p} value="" onChange={vi.fn()} />}
        </FormField>
      </FormErrorProvider>,
    );

    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.id).toMatch(/^ff-/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe(`${input.id}-err`);

    const focusSpy = vi.spyOn(input, 'focus');
    fireEvent.click(screen.getByRole('button', { name: /Choose a folder/ }));
    expect(focusSpy).toHaveBeenCalled();
  });

  it("wires the ColorPicker's hex input without dropping its own error", () => {
    render(
      <FormErrorProvider>
        <FormErrorSummary />
        <FormField label="Accent" error="Accent is required" validateOn="change">
          {(p) => <ColorPicker {...p} value="#8b5cf6" onChange={vi.fn()} />}
        </FormField>
      </FormErrorProvider>,
    );

    const hex = document.querySelector('input[type="text"]') as HTMLInputElement;
    expect(hex.id).toMatch(/^ff-/);
    expect(hex).toHaveAttribute('aria-invalid', 'true');
    expect(hex.getAttribute('aria-describedby')).toBe(`${hex.id}-err`);
  });

  it('leaves an unwrapped control exactly as it was', () => {
    render(<DirectoryPickerInput value="" onChange={vi.fn()} />);
    const input = document.querySelector('input[type="text"]') as HTMLInputElement;
    expect(input.id).toBe('');
    expect(input).not.toHaveAttribute('aria-invalid');
    expect(input).not.toHaveAttribute('aria-describedby');
  });
});
