import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '@/features/plugins/companion/companionStore';
import type { SttComparison } from '@/features/plugins/companion/useSttComparison';
import { useCreateAthenaEngine } from '../engine/useCreateAthenaEngine';
import { resetWakeUpRotation } from '../engine/createAthenaSteps';

const api = vi.hoisted(() => ({
  kokoroStatus: vi.fn(),
  pocketStatus: vi.fn(),
  kokoroVoices: vi.fn(),
  pocketVoices: vi.fn(),
  sttStatus: vi.fn(),
  listClaudeAccounts: vi.fn(),
  synthesize: vi.fn(),
  play: vi.fn(),
  playReplyChime: vi.fn(),
}));

vi.mock('@/api/companion', () => ({
  KOKORO_INSTALL_EVENT: 'companion://kokoro-install',
  POCKET_INSTALL_EVENT: 'companion://pocket-install',
  companionTtsKokoroStatus: api.kokoroStatus,
  companionTtsPocketStatus: api.pocketStatus,
  companionTtsKokoroDownload: vi.fn(),
  companionTtsPocketDownload: vi.fn(),
  companionTtsListKokoroVoices: api.kokoroVoices,
  companionTtsListPocketVoices: api.pocketVoices,
  companionSttEngineStatus: api.sttStatus,
}));
vi.mock('@/api/fleet/claudeAccounts', () => ({ listClaudeAccounts: api.listClaudeAccounts }));
vi.mock('@/features/plugins/companion/voicePlayback', () => ({
  synthesize: api.synthesize,
  play: api.play,
}));
vi.mock('@/features/plugins/companion/chime', () => ({ playReplyChime: api.playReplyChime }));
// jsdom has neither SpeechRecognition nor getUserMedia — the comparison hook
// is pinned in its own suite; here it is an inert take.
vi.mock('@/features/plugins/companion/useSttComparison', () => ({
  useSttComparison: (): SttComparison => ({
    recording: false,
    busy: false,
    hasResult: false,
    browser: { supported: true, busy: false, text: '', interim: '', error: null, elapsedMs: null },
    whisper: { supported: true, busy: false, text: '', interim: '', error: null, elapsedMs: null },
    start: vi.fn(),
    stop: vi.fn(),
    reset: vi.fn(),
  }),
}));

const installedStatus = {
  engineInstalled: true,
  modelInstalled: true,
  canAutoInstall: true,
  engineDownloadUrl: 'https://example.invalid/engine',
  modelDownloadUrl: 'https://example.invalid/model',
};

beforeEach(() => {
  vi.clearAllMocks();
  resetWakeUpRotation();
  api.kokoroStatus.mockResolvedValue(installedStatus);
  api.pocketStatus.mockResolvedValue({ ...installedStatus, engineInstalled: false });
  api.kokoroVoices.mockResolvedValue([
    { voiceId: 'af_heart', speaker: 'Heart', gender: 'female', languageLabel: 'English (US)', grade: 'A' },
  ]);
  api.pocketVoices.mockResolvedValue([]);
  api.sttStatus.mockResolvedValue({ installed: false });
  api.listClaudeAccounts.mockResolvedValue({ livePresent: true, accounts: [] });
  api.synthesize.mockResolvedValue('blob:preview');
  api.play.mockImplementation(() => ({ audio: { pause: vi.fn() }, done: Promise.resolve() }));
  // jsdom ships neither; the preview only ever revokes what synthesize returned.
  URL.revokeObjectURL = vi.fn();
  useSystemStore.setState({
    athenaOnboardingStep: null,
    athenaOnboardingCompletedAt: null,
    companionFooterEnabled: false,
    companionOrbEnabled: true,
    companionSoundEnabled: false,
    companionVoiceEngine: 'kokoro',
    companionKokoroVoiceId: null,
    companionPocketVoiceId: null,
    companionVoiceEnabled: false,
  });
  useCompanionStore.setState({ pendingChatPrompt: null, activeWalkthrough: null });
});

describe('useCreateAthenaEngine', () => {
  it('fresh mount lands on intro/fresh; a stored pointer resumes', () => {
    const { result } = renderHook(() => useCreateAthenaEngine());
    expect(result.current.stepId).toBe('intro');
    expect(result.current.card).toEqual({ kind: 'intro', mode: 'fresh' });
    expect(result.current.canBack).toBe(false);
    expect(result.current.line.id).toBe('intro:fresh');

    useSystemStore.setState({ athenaOnboardingStep: 'chime' });
    const resumed = renderHook(() => useCreateAthenaEngine());
    expect(resumed.result.current.stepId).toBe('chime');
    act(() => resumed.result.current.actions.goTo('intro'));
    expect(resumed.result.current.card).toEqual({ kind: 'intro', mode: 'resume' });
  });

  it('next persists the pointer through the store', () => {
    const { result } = renderHook(() => useCreateAthenaEngine());
    act(() => result.current.actions.next());
    expect(useSystemStore.getState().athenaOnboardingStep).toBe('footer_icon');
    expect(result.current.stepId).toBe('footer_icon');
    expect(result.current.steps.find((s) => s.id === 'intro')?.status).toBe('done');
    expect(result.current.canNext).toBe(false);
  });

  it('entering footer_icon flips the real key on and glows the footer icon', () => {
    const flash = vi.spyOn(useCompanionStore.getState(), 'flashHighlight');
    useCompanionStore.setState({ flashHighlight: flash });
    const { result } = renderHook(() => useCreateAthenaEngine());
    act(() => result.current.actions.next());
    expect(useSystemStore.getState().companionFooterEnabled).toBe(true);
    expect(flash).toHaveBeenCalledWith('footer-companion', { ms: 2500 });
    expect(result.current.card).toMatchObject({ kind: 'keep_toggle', feature: 'footer_icon', enabled: true, choice: null });
    act(() => result.current.actions.keepFeature('footer_icon', true));
    expect(result.current.canNext).toBe(true);
  });

  it('keepFeature(orb, false) turns the orb off and auto-skips orb_place', () => {
    useSystemStore.setState({ athenaOnboardingStep: 'orb' });
    const { result } = renderHook(() => useCreateAthenaEngine());
    act(() => result.current.actions.keepFeature('orb', false));
    expect(useSystemStore.getState().companionOrbEnabled).toBe(false);
    act(() => result.current.actions.next());
    expect(result.current.stepId).toBe('chime');
    expect(result.current.steps.find((s) => s.id === 'orb_place')?.status).toBe('skipped');
    expect(api.playReplyChime).toHaveBeenCalledTimes(1);
    expect(useSystemStore.getState().companionSoundEnabled).toBe(true);
  });

  it('voice_install is passed over as done when the engine is already installed', async () => {
    useSystemStore.setState({ athenaOnboardingStep: 'voice_engine' });
    const { result } = renderHook(() => useCreateAthenaEngine());
    await waitFor(() => expect(result.current.card).toMatchObject({ kind: 'engine_pick', selected: 'kokoro' }));
    act(() => result.current.actions.confirmEngine());
    act(() => result.current.actions.next());
    expect(result.current.stepId).toBe('voice_pick');
    expect(result.current.steps.find((s) => s.id === 'voice_install')?.status).toBe('done');
  });

  it('first preview speaks a wake-up line and selects the voice; the second speaks the test sentence', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 17, 9, 0, 0));
    useSystemStore.setState({ athenaOnboardingStep: 'voice_pick' });
    const { result } = renderHook(() => useCreateAthenaEngine());
    await waitFor(() => expect(result.current.card).toMatchObject({ kind: 'voice_pick', loading: false }));

    act(() => result.current.actions.previewVoice('af_heart'));
    await waitFor(() => expect(result.current.card).toMatchObject({ kind: 'voice_pick', wokeUp: true }));
    expect(api.synthesize.mock.calls[0]?.[0]).toMatch(/^Good morning/);
    expect(useSystemStore.getState().companionKokoroVoiceId).toBe('af_heart');
    expect(result.current.line.id).toBe('voice_pick:woke');
    expect(result.current.canNext).toBe(true);

    act(() => result.current.actions.previewVoice('af_heart'));
    await waitFor(() => expect(api.synthesize).toHaveBeenCalledTimes(2));
    expect(api.synthesize.mock.calls[1]?.[0]).toBe('Hello, I am Athena, your personal AI assistant.');
    vi.useRealTimers();
  });

  it('finish with a Claude login stamps completion and hands the chat the prompt', async () => {
    useSystemStore.setState({ athenaOnboardingStep: 'handoff', companionKokoroVoiceId: 'af_heart' });
    const { result } = renderHook(() => useCreateAthenaEngine());
    await waitFor(() => expect(result.current.card).toMatchObject({ kind: 'handoff', hasClaudeLogin: true, voiceReady: true }));
    expect(result.current.line.id).toBe('handoff:voice');
    act(() => result.current.actions.finish());
    const sys = useSystemStore.getState();
    expect(sys.athenaOnboardingStep).toBeNull();
    expect(sys.athenaOnboardingCompletedAt).toBeTruthy();
    expect(sys.companionVoiceEnabled).toBe(true);
    expect(useCompanionStore.getState().pendingChatPrompt).toEqual({
      text: 'Show me what you can do here — walk me through your main capabilities in this app, briefly.',
      source: 'Create Athena',
    });
  });

  it('restart clears local choices and returns to intro', () => {
    useSystemStore.setState({ athenaOnboardingStep: 'footer_icon' });
    const { result } = renderHook(() => useCreateAthenaEngine());
    act(() => result.current.actions.keepFeature('footer_icon', true));
    act(() => result.current.actions.restart());
    expect(result.current.stepId).toBe('intro');
    expect(useSystemStore.getState().athenaOnboardingStep).toBe('intro');
    act(() => result.current.actions.next());
    expect(result.current.card).toMatchObject({ kind: 'keep_toggle', choice: null });
  });
});
