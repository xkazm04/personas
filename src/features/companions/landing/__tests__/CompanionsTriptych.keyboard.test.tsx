// Keyboard activation, through the app's real keyboard registry: 1/2/3 choose
// a column, the arrows move between them, and the column is a real button so
// Enter and Space open it without a hand-rolled key handler.
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';

import { CompanionsTriptych } from '../CompanionsTriptych';
import type { CompanionStatusDto } from '../../types';

vi.mock('@/i18n/useTranslation', async () => {
  // INVARIANT: the en section file IS the `companions` subtree of the bundle -
  // the generator builds the types from it and check:i18n:strict gates drift.
  const companions = (await import('@/i18n/section-locales/en/companions.json')).default;
  return { useTranslation: () => ({ t: { companions }, language: 'en', tx: (s: string) => s }) };
});

const STATUS: CompanionStatusDto[] = [
  { id: 'athena', enabled: true, eligible: true, onboarded: true, detail: { pendingDecisions: 2 } },
  { id: 'overseer', enabled: false, eligible: false, blocker: 'no_starred_personas', onboarded: true, detail: { starredCount: 0, agentsTotal: 16 } },
  { id: 'curator', enabled: false, eligible: true, onboarded: true, detail: { registryName: 'ai-registry' } },
];

function mount(onOpen = vi.fn()) {
  render(
    <AppKeyboardProvider>
      <input data-testid="elsewhere" />
      <CompanionsTriptych companions={STATUS} loading={false} onOpen={onOpen} />
    </AppKeyboardProvider>,
  );
  return onOpen;
}

const focusedId = () => (document.activeElement as HTMLElement | null)?.dataset.id;

afterEach(cleanup);

describe('keyboard activation', () => {
  it('1, 2 and 3 choose a column', async () => {
    mount();
    const user = userEvent.setup();
    await user.keyboard('1');
    expect(focusedId()).toBe('athena');
    await user.keyboard('2');
    expect(focusedId()).toBe('overseer');
    await user.keyboard('3');
    expect(focusedId()).toBe('curator');
  });

  it('the arrows move along the triptych and wrap', async () => {
    mount();
    const user = userEvent.setup();
    await user.keyboard('1');
    await user.keyboard('{ArrowRight}');
    expect(focusedId()).toBe('overseer');
    await user.keyboard('{ArrowLeft}');
    await user.keyboard('{ArrowLeft}');
    expect(focusedId()).toBe('curator');
  });

  it('Enter opens the focused column at its own destination', async () => {
    const onOpen = mount();
    const user = userEvent.setup();
    await user.keyboard('3');
    await user.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: 'curator', target: 'curator:setup' });
  });

  it('Space opens it too, because the column is a real button', async () => {
    const onOpen = mount();
    const user = userEvent.setup();
    await user.keyboard('2');
    await user.keyboard(' ');
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: 'overseer', target: 'overseer:setup' });
  });

  it('clicking a column opens it', async () => {
    const onOpen = mount();
    await userEvent.setup().click(screen.getByTestId('companion-column-athena'));
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: 'athena', target: 'athena:setup' });
  });

  it('a digit typed into a field is a digit, not a shortcut', async () => {
    mount();
    const user = userEvent.setup();
    const field = screen.getByTestId('elsewhere');
    await user.click(field);
    await user.keyboard('2');
    expect(focusedId()).toBeUndefined();
    expect(field).toHaveValue('2');
  });

  it('the cold load paints three column frames and no spinner', () => {
    render(
      <AppKeyboardProvider>
        <CompanionsTriptych companions={null} loading onOpen={vi.fn()} />
      </AppKeyboardProvider>,
    );
    expect(document.querySelectorAll('[data-role=column]')).toHaveLength(3);
    // Substring selectors on purpose: they cover every spin/pulse class, and
    // spelling the literal class name here would add a `hand-rolled-spinner`
    // violation to the census for a test that asserts the opposite.
    expect(document.querySelectorAll('[class*="spin"], [class*="pulse"]')).toHaveLength(0);
  });
});
