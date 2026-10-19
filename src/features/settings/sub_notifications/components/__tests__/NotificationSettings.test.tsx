import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock('@/lib/tauriInvoke', () => ({ invokeWithTimeout: ipc.invoke }));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      common: new Proxy({}, { get: (_target, key) => String(key) }),
      settings: { notifications: new Proxy({}, { get: (_target, key) => String(key) }) },
    },
    tx: (value: string) => value,
  }),
}));
vi.mock('../WebhookSubscriptionsPanel', () => ({ WebhookSubscriptionsPanel: () => null }));
vi.mock('@/features/settings/shared/RecentChangeChip', () => ({ RecentChangeChip: () => null }));

import NotificationSettings from '../NotificationSettings';

function setAppSettingCalls() {
  return ipc.invoke.mock.calls.filter(([cmd]) => cmd === 'set_app_setting');
}

beforeEach(() => {
  ipc.invoke.mockReset().mockImplementation(async (cmd: string) => (cmd === 'get_app_settings_bulk' ? {} : undefined));
});
afterEach(() => {
  vi.useRealTimers();
});

describe('NotificationSettings auto-save', () => {
  it('still writes a toggle made just before the tab unmounts', async () => {
    const view = render(<NotificationSettings />);
    const toggle = (await screen.findAllByRole('switch'))[0];
    vi.useFakeTimers();

    fireEvent.click(toggle);
    // Leave the tab inside the 300 ms debounce window.
    act(() => vi.advanceTimersByTime(100));
    view.unmount();
    act(() => vi.advanceTimersByTime(5_000));

    expect(setAppSettingCalls()).toHaveLength(1);
    const [, args] = setAppSettingCalls()[0];
    expect(args).toMatchObject({ key: 'notification_prefs' });
  });

  it('coalesces rapid toggles into one write after the debounce', async () => {
    render(<NotificationSettings />);
    const toggle = (await screen.findAllByRole('switch'))[0];
    vi.useFakeTimers();

    fireEvent.click(toggle);
    act(() => vi.advanceTimersByTime(100));
    fireEvent.click(toggle);
    expect(setAppSettingCalls()).toHaveLength(0);
    act(() => vi.advanceTimersByTime(400));

    expect(setAppSettingCalls()).toHaveLength(1);
  });

  it('writes nothing when the operator changed nothing', async () => {
    const view = render(<NotificationSettings />);
    await screen.findAllByRole('switch');
    view.unmount();
    expect(setAppSettingCalls()).toHaveLength(0);
  });
});
