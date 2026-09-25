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

const { useAthenaStore } = await import('../../athenaStore');
const { useSystemStore } = await import('@/stores/systemStore');
const { useAthenaOrbPresence, useAthenaOrbShown, isAthenaOrbShown } = await import('../athenaOrbPresence');

afterEach(() => {
  useAthenaStore.setState({ orbBusySources: {}, orbSpeakingSources: {} });
});

const presence = () => renderHook(() => useAthenaOrbPresence({ talking: false, interimText: '', orbSize: 64 }));

describe('the orb contribution slice', () => {
  it('each source sets and clears only its own flag, and a no-op keeps the same object', () => {
    const s = useAthenaStore.getState();
    s.setOrbBusy('studio', true);
    s.setOrbBusy('other', true);
    const before = useAthenaStore.getState().orbBusySources;
    useAthenaStore.getState().setOrbBusy('studio', true);
    expect(useAthenaStore.getState().orbBusySources).toBe(before);
    useAthenaStore.getState().setOrbBusy('studio', false);
    expect(useAthenaStore.getState().orbBusySources).toEqual({ other: true });
  });
});

describe('the orb reads it', () => {
  it('a busy surface puts her in the working posture with a task dot', () => {
    const { result } = presence();
    expect(result.current.avatarState).toBe('idle');
    act(() => useAthenaStore.getState().setOrbBusy('studio', true));
    expect(result.current.avatarState).toBe('thinking');
    expect(result.current.runningTaskCount).toBe(1);
    expect(result.current.taskDots).toHaveLength(1);
  });

  it('a clip playing in her voice shows her speaking, even while that surface works', () => {
    const { result } = presence();
    act(() => {
      useAthenaStore.getState().setOrbBusy('studio', true);
      useAthenaStore.getState().setOrbSpeaking('studio-read', true);
    });
    expect(result.current.avatarState).toBe('speaking');
    expect(result.current.speaking).toBe(true);
    act(() => useAthenaStore.getState().setOrbSpeaking('studio-read', false));
    expect(result.current.avatarState).toBe('thinking');
  });

  it('knows when the app-wide orb is on screen: enabled and minimized', () => {
    expect(isAthenaOrbShown(true, 'minimized')).toBe(true);
    expect(isAthenaOrbShown(true, 'open')).toBe(false);
    expect(isAthenaOrbShown(false, 'minimized')).toBe(false);
    useSystemStore.setState({ athenaOrbEnabled: true } as never);
    useAthenaStore.setState({ state: 'minimized' } as never);
    const { result } = renderHook(() => useAthenaOrbShown());
    expect(result.current).toBe(true);
  });
});
