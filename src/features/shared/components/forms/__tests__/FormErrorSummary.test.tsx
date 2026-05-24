import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Minimal i18n mock: tx interpolates {count} so the title assertions are real.
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      common: {
        form_error_summary_title_one: '{count} field needs your attention',
        form_error_summary_title_other: '{count} fields need your attention',
      },
    },
    tx: (s: string, vars: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')),
  }),
}));

import { FormField } from '../FormField';
import { FormErrorProvider } from '../FormErrorContext';
import { FormErrorSummary } from '../FormErrorSummary';

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
