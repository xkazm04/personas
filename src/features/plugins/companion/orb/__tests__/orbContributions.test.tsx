import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// One Athena: other surfaces (Studio) show their work and speech on the
// app-wide orb through the contribution slice, instead of drawing a second
// Athena of their own.

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_, k) => String(k) }) }),
    tx: (s: string) => s,
  }),
}));

const { useCompanionStore } = await import('../../companionStore');
const { useSystemStore } = await import('@/stores/systemStore');
const { useAthenaOrbPresence, useAthenaOrbShown, isAthenaOrbShown } = await import('../athenaOrbPresence');

afterEach(() => {
  useCompanionStore.setState({ orbBusySources: {}, orbSpeakingSources: {} });
});

const presence = () => renderHook(() => useAthenaOrbPresence({ talking: false, interimText: '', orbSize: 64 }));

describe('the orb contribution slice', () => {
  it('each source sets and clears only its own flag, and a no-op keeps the same object', () => {
    const s = useCompanionStore.getState();
    s.setOrbBusy('studio', true);
    s.setOrbBusy('other', true);
    const before = useCompanionStore.getState().orbBusySources;
    useCompanionStore.getState().setOrbBusy('studio', true);
    expect(useCompanionStore.getState().orbBusySources).toBe(before);
    useCompanionStore.getState().setOrbBusy('studio', false);
    expect(useCompanionStore.getState().orbBusySources).toEqual({ other: true });
  });
});

describe('the orb reads it', () => {
  it('a busy surface puts her in the working posture with a task dot', () => {
    const { result } = presence();
    expect(result.current.avatarState).toBe('idle');
    act(() => useCompanionStore.getState().setOrbBusy('studio', true));
    expect(result.current.avatarState).toBe('thinking');
    expect(result.current.runningTaskCount).toBe(1);
    expect(result.current.taskDots).toHaveLength(1);
  });

  it('a clip playing in her voice shows her speaking, even while that surface works', () => {
    const { result } = presence();
    act(() => {
      useCompanionStore.getState().setOrbBusy('studio', true);
      useCompanionStore.getState().setOrbSpeaking('studio-read', true);
    });
    expect(result.current.avatarState).toBe('speaking');
    expect(result.current.speaking).toBe(true);
    act(() => useCompanionStore.getState().setOrbSpeaking('studio-read', false));
    expect(result.current.avatarState).toBe('thinking');
  });

  it('knows when the app-wide orb is on screen: enabled and minimized', () => {
    expect(isAthenaOrbShown(true, 'minimized')).toBe(true);
    expect(isAthenaOrbShown(true, 'open')).toBe(false);
    expect(isAthenaOrbShown(false, 'minimized')).toBe(false);
    useSystemStore.setState({ companionOrbEnabled: true } as never);
    useCompanionStore.setState({ state: 'minimized' } as never);
    const { result } = renderHook(() => useAthenaOrbShown());
    expect(result.current).toBe(true);
  });
});
