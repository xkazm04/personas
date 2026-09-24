import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// A taken name used to be refused only after submit, as a toast, while Studio
// fell back to showing the existing project. The form now refuses it inline.

const TAKEN = new Set(['portfolio']);
vi.mock('@/api/webbuild', () => ({
  webbuildBunStatus: () => Promise.resolve('/usr/bin/bun'),
  // The scaffold's rule, as the backend answers it: the folder must be free.
  webbuildCheckName: (name: string) => {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || null;
    const taken = !!slug && TAKEN.has(slug);
    return Promise.resolve({ slug, taken, suggestion: taken ? `${slug}-2` : null });
  },
}));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => vi.fn(), toastCatch: () => vi.fn() }));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      common: { retry: 'Retry' },
      studio: new Proxy({}, { get: (_, k) => (k === 'guide' ? new Proxy({}, { get: (_, kk) => String(kk) }) : String(k)) }),
    },
    tx: (s: string) => s,
  }),
}));

const StudioVisionStart = (await import('../StudioVisionStart')).default;

afterEach(cleanup);

describe('the new-project form', () => {
  it('refuses a taken name inline and keeps Build disabled', async () => {
    const onSubmit = vi.fn();
    render(<StudioVisionStart onSubmit={onSubmit} busy={false} error={null} />);
    fireEvent.change(screen.getByTestId('studio-vision-text'), { target: { value: 'A portfolio' } });
    fireEvent.change(screen.getByTestId('studio-vision-name'), { target: { value: 'Portfolio' } });
    expect(await screen.findByTestId('studio-vision-name-problem')).toBeTruthy();
    expect(screen.getByText('name_taken')).toBeTruthy();
    const submit = screen.getByTestId('studio-vision-submit') as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(true));
    fireEvent.change(screen.getByTestId('studio-vision-name'), { target: { value: 'portfolio-2' } });
    expect(screen.queryByTestId('studio-vision-name-problem')).toBeNull();
    await waitFor(() => expect(submit.disabled).toBe(false));
  });

  it('a starter picks a free name instead of a taken one', async () => {
    render(<StudioVisionStart onSubmit={vi.fn()} busy={false} error={null} />);
    fireEvent.click(screen.getAllByTestId('studio-vision-starter')[0]!);
    await waitFor(() => expect((screen.getByTestId('studio-vision-name') as HTMLInputElement).value).toBe('portfolio-2'));
  });

  it('survives busy flipping on and off (the name check must not sit after the early return)', () => {
    // Classic keeps the form mounted while it creates: busy flips on the same
    // instance, and a hook placed after `if (busy) return` changes the hook
    // count and throws "Rendered fewer hooks than expected".
    const r = render(<StudioVisionStart onSubmit={vi.fn()} busy={false} error={null} />);
    expect(() => r.rerender(<StudioVisionStart onSubmit={vi.fn()} busy error={null} />)).not.toThrow();
    expect(screen.getByText('setting_up')).toBeTruthy();
    expect(() => r.rerender(<StudioVisionStart onSubmit={vi.fn()} busy={false} error={null} />)).not.toThrow();
    expect(screen.getByTestId('studio-vision-name')).toBeTruthy();
  });

  it('shows a create failure inside the form', () => {
    render(<StudioVisionStart onSubmit={vi.fn()} busy={false} error="project directory already exists" />);
    expect(screen.getByTestId('studio-vision-error').textContent).toContain('project directory already exists');
  });
});
