// A failed first read states itself: the error banner stands alone, with no
// loading ghosts drawn beside it that would never resolve.
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';

import { CompanionsTriptych } from '../CompanionsTriptych';

vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  const companions = (await import('@/i18n/section-locales/en/companions.json')).default;
  return {
    ...actual,
    useTranslation: () => ({ t: { companions }, language: 'en', tx: actual.interpolate }),
  };
});

afterEach(cleanup);

const mount = (props: { loading: boolean; error?: string | null }) =>
  render(
    <AppKeyboardProvider>
      <CompanionsTriptych companions={null} onOpen={vi.fn()} {...props} />
    </AppKeyboardProvider>,
  );

describe('first read of the companions', () => {
  it('draws loading ghosts while the read is in flight', () => {
    const { container } = mount({ loading: true });
    expect(container.querySelectorAll('[data-state="loading"]').length).toBe(3);
  });

  it('shows the error without loading ghosts when the read failed', () => {
    const { container } = mount({ loading: false, error: 'companions_status failed' });
    expect(container.textContent).toContain('companions_status failed');
    expect(container.querySelectorAll('[data-state="loading"]').length).toBe(0);
  });
});
