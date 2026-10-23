import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

vi.mock('@tauri-apps/api/app', () => ({ getVersion: vi.fn(async () => '2.0.0') }));

async function load(seen: string | null) {
  vi.resetModules();
  const { useSystemStore } = await import('@/stores/systemStore');
  useSystemStore.setState({ whatsNewSeenVersion: seen });
  const { useWhatsNewIndicator } = await import('./useWhatsNewIndicator');
  return { useWhatsNewIndicator, useSystemStore };
}

describe('useWhatsNewIndicator visibility rule', () => {
  beforeEach(() => { vi.unstubAllEnvs(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it('shows no dot in production even after a version change (the tab is DEV-only)', async () => {
    vi.stubEnv('DEV', false);
    const { useWhatsNewIndicator, useSystemStore } = await load('1.0.0');
    const { result } = renderHook(() => useWhatsNewIndicator());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.hasUpdate).toBe(false);
    expect(useSystemStore.getState().whatsNewSeenVersion).toBe('1.0.0');
  });

  it('shows the dot in DEV after a version change', async () => {
    vi.stubEnv('DEV', true);
    const { useWhatsNewIndicator } = await load('1.0.0');
    const { result } = renderHook(() => useWhatsNewIndicator());
    await waitFor(() => expect(result.current.hasUpdate).toBe(true));
  });
});
