/** Desktop pipeline notifications read their title and body from the gitlab catalog. */
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', async () => {
  const en = (await import('@/i18n/locales/en.json')).default as Record<string, unknown>;
  const toMarkers = (node: unknown, path: string): unknown =>
    node && typeof node === 'object'
      ? Object.fromEntries(Object.entries(node).map(([k, v]) => [k, toMarkers(v, path ? `${path}.${k}` : k)]))
      : path;
  const t = toMarkers(en, '');
  return {
    useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
    interpolate: (s: unknown) => String(s),
  };
});

const send = vi.fn();
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(async () => true),
  requestPermission: vi.fn(async () => 'granted'),
  sendNotification: (a: unknown) => send(a),
}));

import { usePipelineNotifications } from '../usePipelineNotifications';

const pipe = (status: string) => [{ id: 7, ref: 'main', status, webUrl: 'https://x' }] as never;

describe('usePipelineNotifications copy', () => {
  it('notifies with catalog title and body when a pipeline finishes', async () => {
    const { rerender } = renderHook(({ p }) => usePipelineNotifications(p, 1), { initialProps: { p: pipe('running') } });
    await Promise.resolve();
    await Promise.resolve();
    rerender({ p: pipe('failed') });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      title: 'gitlab.notify_title_failed',
      body: 'gitlab.notify_body',
    }));
  });
});
