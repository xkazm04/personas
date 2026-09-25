import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// Studio's read-aloud speaks in Athena's voice, so the app-wide orb shows her
// speaking while the clip plays, and stops when it ends or is stopped.

let finish!: () => void;
const pause = vi.fn();
vi.mock('@/features/plugins/companion/voicePlayback', () => ({
  synthesize: vi.fn(async () => 'blob:clip'),
  play: vi.fn(() => ({ audio: { pause } as unknown as HTMLAudioElement, done: new Promise<void>((r) => { finish = r; }) })),
}));
vi.mock('@/features/plugins/companion/useTtsVoiceSelection', () => ({
  useTtsVoiceSelection: () => ({ engine: 'kokoro', voiceId: 'v', credentialId: null, configured: true }),
}));
vi.mock('@/features/plugins/companion/useTtsSettings', () => ({ useTtsSettings: () => undefined }));

const { useCompanionStore } = await import('@/features/plugins/companion/companionStore');
const { useGuideReadAloud, READ_ALOUD_ORB_SOURCE } = await import('../guide/useGuideReadAloud');
const speaking = () => !!useCompanionStore.getState().orbSpeakingSources[READ_ALOUD_ORB_SOURCE];
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => useCompanionStore.setState({ orbSpeakingSources: {} }));

describe('read aloud on the orb', () => {
  it('lights while the clip plays and clears when it ends', async () => {
    const { result } = renderHook(() => useGuideReadAloud());
    await act(async () => {
      result.current.speak('The hero is in.');
      await flush();
    });
    expect(speaking()).toBe(true);
    await act(async () => {
      finish();
      await flush();
    });
    expect(speaking()).toBe(false);
  });

  it('clears when stopped, and when the tool goes away', async () => {
    const { result, unmount } = renderHook(() => useGuideReadAloud());
    await act(async () => {
      result.current.speak('Next the menu.');
      await flush();
    });
    act(() => result.current.stop());
    expect(speaking()).toBe(false);
    await act(async () => {
      result.current.speak('Again.');
      await flush();
    });
    unmount();
    expect(speaking()).toBe(false);
  });
});
