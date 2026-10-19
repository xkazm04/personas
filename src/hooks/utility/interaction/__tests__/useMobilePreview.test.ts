import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

// A dev phone build (VITE_PLATFORM=android|ios) must render the mobile layout
// without the Ctrl+Shift+M preview toggle. The hook used to read build globals
// nothing defines, so it disagreed with platform.ts's IS_MOBILE in dev.
describe('useMobilePreview in a dev phone build', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['android', 'ios'])('is true for VITE_PLATFORM=%s with the preview toggle off', async (platform) => {
    vi.stubEnv('VITE_PLATFORM', platform);
    vi.resetModules();
    const { useMobilePreview } = await import('../useMobilePreview');
    const { isMobilePreviewActive } = await import('@/lib/utils/platform/platform');
    expect(isMobilePreviewActive()).toBe(false);
    const { result } = renderHook(() => useMobilePreview());
    expect(result.current).toBe(true);
  });

  it('is false for a desktop dev build with the preview toggle off', async () => {
    vi.stubEnv('VITE_PLATFORM', '');
    vi.resetModules();
    const { useMobilePreview } = await import('../useMobilePreview');
    const { result } = renderHook(() => useMobilePreview());
    expect(result.current).toBe(false);
  });
});
