import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks — must precede import of the module under test
// ---------------------------------------------------------------------------

let mockStoreState: Record<string, unknown> = {};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockStoreState),
  ),
}));

vi.mock('@/features/plugins/companion/useTtsSettings', () => ({
  useTtsSettings: vi.fn(() => undefined),
}));

const mockSynthesize = vi.fn().mockResolvedValue('blob:narration');
const mockPause = vi.fn();
const mockPlay = vi.fn(() => ({
  audio: { pause: mockPause } as unknown as HTMLAudioElement,
  done: Promise.resolve(),
}));

vi.mock('@/features/plugins/companion/voicePlayback', () => ({
  synthesize: (...args: unknown[]) => mockSynthesize(...args),
  play: (...args: unknown[]) => mockPlay(...args),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => {},
}));

import { useTourNarration } from '../useTourNarration';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setVoice(overrides: Partial<Record<string, unknown>> = {}) {
  mockStoreState = {
    companionVoiceEnabled: true,
    companionVoiceEngine: 'elevenlabs',
    companionVoiceCredentialId: 'cred-1',
    companionVoiceId: 'voice-1',
    companionPiperVoiceId: null,
    companionVoiceVolume: 0.5,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setVoice();
});

const STEP = { active: true, stepId: 'appearance-setup', narration: 'Hello there.' };

// ---------------------------------------------------------------------------

describe('useTourNarration', () => {
  it('is unavailable and silent when voice is disabled', () => {
    setVoice({ companionVoiceEnabled: false });
    const { result } = renderHook(() => useTourNarration(STEP));
    expect(result.current.available).toBe(false);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('is unavailable when the step has no narration text', () => {
    const { result } = renderHook(() =>
      useTourNarration({ ...STEP, narration: undefined }),
    );
    expect(result.current.available).toBe(false);
    expect(mockSynthesize).not.toHaveBeenCalled();
  });

  it('is unavailable when ElevenLabs is selected but no credential is set', () => {
    setVoice({ companionVoiceCredentialId: null });
    const { result } = renderHook(() => useTourNarration(STEP));
    expect(result.current.available).toBe(false);
  });

  it('synthesizes the step narration through ElevenLabs when configured', async () => {
    const { result } = renderHook(() => useTourNarration(STEP));
    expect(result.current.available).toBe(true);
    await waitFor(() => expect(mockSynthesize).toHaveBeenCalledTimes(1));
    expect(mockSynthesize).toHaveBeenCalledWith(
      'Hello there.',
      'cred-1',
      'voice-1',
      undefined,
      'elevenlabs',
    );
    await waitFor(() => expect(mockPlay).toHaveBeenCalledWith('blob:narration'));
  });

  it('uses the Piper voice id and a null credential when Piper is the engine', async () => {
    setVoice({
      companionVoiceEngine: 'piper',
      companionVoiceCredentialId: null,
      companionVoiceId: null,
      companionPiperVoiceId: 'en_US-amy-medium',
    });
    const { result } = renderHook(() => useTourNarration(STEP));
    expect(result.current.available).toBe(true);
    await waitFor(() => expect(mockSynthesize).toHaveBeenCalledTimes(1));
    expect(mockSynthesize).toHaveBeenCalledWith(
      'Hello there.',
      null,
      'en_US-amy-medium',
      undefined,
      'piper',
    );
  });

  it('does not auto-speak while muted, and replay ignores mute', async () => {
    const { result } = renderHook(() => useTourNarration(STEP));
    await waitFor(() => expect(mockSynthesize).toHaveBeenCalledTimes(1));

    act(() => result.current.toggleMute());
    expect(result.current.muted).toBe(true);

    // Replay re-speaks (cached url → play again) even while muted.
    act(() => result.current.replay());
    await waitFor(() => expect(mockPlay).toHaveBeenCalledTimes(2));
  });

  it('does not synthesize when the tour is inactive', () => {
    renderHook(() => useTourNarration({ ...STEP, active: false }));
    expect(mockSynthesize).not.toHaveBeenCalled();
  });
});
