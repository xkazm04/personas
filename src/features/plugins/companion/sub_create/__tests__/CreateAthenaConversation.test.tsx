import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import CreateAthenaConversation from '../variants/CreateAthenaConversation';
import {
  CREATE_ATHENA_STEP_ORDER,
  type CreateAthenaActions,
  type CreateAthenaCard,
  type CreateAthenaEngine,
  type CreateAthenaStepId,
  type InstallState,
} from '../engine/createAthenaTypes';
import type { EngineTake } from '../../useSttComparison';

// The shell gates the card on TypedLine's `onDone`; the stub never fires it,
// so the mock reports the line as fully shown on mount.
vi.mock('../shared/TypedLine', () => ({
  TypedLine: ({ text, onDone }: { text: string; onDone?: () => void }) => {
    onDone?.();
    return <p data-testid="typed-line">{text}</p>;
  },
}));
vi.mock('@/features/plugins/companion/AthenaAvatar', () => ({
  AthenaAvatar: ({ state }: { state: string }) => <div data-testid="athena-avatar" data-state={state} />,
}));
const openExternalUrl = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('@/api/system/system', () => ({ openExternalUrl }));

function actions(): CreateAthenaActions {
  return {
    next: vi.fn(), back: vi.fn(), skip: vi.fn(), goTo: vi.fn(), restart: vi.fn(),
    keepFeature: vi.fn(), confirmOrbPlace: vi.fn(), selectEngine: vi.fn(), confirmEngine: vi.fn(),
    startInstall: vi.fn(), retryInstall: vi.fn(), recheckInstall: vi.fn(), selectVoice: vi.fn(),
    previewVoice: vi.fn(), stopPreview: vi.fn(), sttStart: vi.fn(), sttStop: vi.fn(), sttPick: vi.fn(),
    finish: vi.fn(),
  };
}

function engine(stepId: CreateAthenaStepId, card: CreateAthenaCard, over: Partial<CreateAthenaEngine> = {}): CreateAthenaEngine {
  const stepIndex = CREATE_ATHENA_STEP_ORDER.indexOf(stepId);
  return {
    stepId,
    stepIndex,
    stepCount: CREATE_ATHENA_STEP_ORDER.length,
    steps: CREATE_ATHENA_STEP_ORDER.map((id, i) => ({
      id,
      status: i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo',
    })),
    line: { id: `line-${stepId}`, text: `Athena says ${stepId}` },
    card,
    speaking: false,
    canNext: true,
    canBack: stepIndex > 0,
    actions: actions(),
    ...over,
  };
}

function take(over: Partial<EngineTake> = {}): EngineTake {
  return { supported: true, busy: false, text: '', interim: '', error: null, elapsedMs: null, ...over };
}

function install(phase: InstallState['phase'], over: Partial<InstallState> = {}): InstallState {
  return { phase, bytesDownloaded: 0, bytesTotal: null, error: null, engineDownloadUrl: null, modelDownloadUrl: null, ...over };
}

beforeEach(() => vi.clearAllMocks());

describe('CreateAthenaConversation', () => {
  it('mounts the root, the step dots and only the current line + card', () => {
    const e = engine('intro', { kind: 'intro', mode: 'fresh' });
    render(<CreateAthenaConversation engine={e} />);
    expect(screen.getByTestId('create-athena-conversation')).toBeInTheDocument();
    expect(screen.getByTestId('create-athena-step-dots')).toHaveAttribute('aria-label', 'Step 1 of 10');
    expect(screen.getAllByTestId('create-athena-exchange')).toHaveLength(1);
    expect(screen.getByTestId('typed-line')).toHaveTextContent('Athena says intro');
    expect(screen.getByTestId('create-athena-card-intro')).toBeInTheDocument();
    // No Back on the first step, no skip-all on a fresh run.
    expect(screen.queryByTestId('create-athena-back')).not.toBeInTheDocument();
    expect(screen.queryByTestId('create-athena-skip-all')).not.toBeInTheDocument();
  });

  it('intro: start → next(); a re-run offers skip-all → finish()', () => {
    const e = engine('intro', { kind: 'intro', mode: 'done' });
    render(<CreateAthenaConversation engine={e} />);
    fireEvent.click(screen.getByTestId('create-athena-intro-start'));
    expect(e.actions.next).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-athena-skip-all'));
    expect(e.actions.finish).toHaveBeenCalled();
  });

  it('footer links drive back / skip / restart', () => {
    const e = engine('orb', { kind: 'keep_toggle', feature: 'orb', enabled: true, recommended: 'keep', why: 'because', choice: null }, { canNext: false });
    render(<CreateAthenaConversation engine={e} />);
    fireEvent.click(screen.getByTestId('create-athena-back'));
    fireEvent.click(screen.getByTestId('create-athena-skip'));
    fireEvent.click(screen.getByTestId('create-athena-restart'));
    expect(e.actions.back).toHaveBeenCalled();
    expect(e.actions.skip).toHaveBeenCalled();
    expect(e.actions.restart).toHaveBeenCalled();
  });

  it('keep_toggle: choices call keepFeature, Continue waits for canNext', () => {
    const e = engine('chime', { kind: 'keep_toggle', feature: 'chime', enabled: true, recommended: 'keep', why: 'because', choice: null }, { canNext: false });
    render(<CreateAthenaConversation engine={e} />);
    expect(screen.getByTestId('create-athena-card-keep_toggle')).toHaveTextContent('Recommended');
    expect(screen.getByTestId('create-athena-next')).toBeDisabled();
    fireEvent.click(screen.getByTestId('create-athena-choice-off'));
    expect(e.actions.keepFeature).toHaveBeenCalledWith('chime', false);
    fireEvent.click(screen.getByTestId('create-athena-choice-keep'));
    expect(e.actions.keepFeature).toHaveBeenCalledWith('chime', true);
  });

  it('orb_place: confirm then Continue', () => {
    const e = engine('orb_place', { kind: 'orb_place', confirmed: false });
    render(<CreateAthenaConversation engine={e} />);
    fireEvent.click(screen.getByTestId('create-athena-orb-place-done'));
    expect(e.actions.confirmOrbPlace).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-athena-next'));
    expect(e.actions.next).toHaveBeenCalled();
  });

  it('engine_pick: tiles select, choose confirms, badges reflect install state', () => {
    const e = engine('voice_engine', {
      kind: 'engine_pick',
      options: [
        { id: 'kokoro', installed: true, canAutoInstall: true },
        { id: 'pocket_tts', installed: false, canAutoInstall: true },
      ],
      selected: 'kokoro', recommended: 'kokoro', why: 'fast', confirmed: false,
    });
    render(<CreateAthenaConversation engine={e} />);
    expect(screen.getByTestId('create-athena-engine-kokoro')).toHaveTextContent('Installed');
    expect(screen.getByTestId('create-athena-engine-pocket_tts')).toHaveTextContent('Needs install');
    fireEvent.click(screen.getByTestId('create-athena-engine-pocket_tts'));
    expect(e.actions.selectEngine).toHaveBeenCalledWith('pocket_tts');
    fireEvent.click(screen.getByTestId('create-athena-engine-choose'));
    expect(e.actions.confirmEngine).toHaveBeenCalled();
  });

  it('install: idle starts, downloading shows progress, failed retries, manual opens links and rechecks', () => {
    const idle = engine('voice_install', { kind: 'install', engine: 'kokoro', state: install('idle') });
    const { unmount } = render(<CreateAthenaConversation engine={idle} />);
    fireEvent.click(screen.getByTestId('create-athena-install-start'));
    expect(idle.actions.startInstall).toHaveBeenCalled();
    unmount();

    const r2 = render(<CreateAthenaConversation engine={engine('voice_install', { kind: 'install', engine: 'kokoro', state: install('downloading_model', { bytesDownloaded: 50, bytesTotal: 200 }) })} />);
    expect(screen.getByRole('progressbar', { name: 'Downloading model' })).toHaveAttribute('aria-valuenow', '25');
    r2.unmount();

    const failed = engine('voice_install', { kind: 'install', engine: 'kokoro', state: install('failed', { error: 'disk full' }) });
    const r3 = render(<CreateAthenaConversation engine={failed} />);
    expect(screen.getByTestId('create-athena-install-error')).toHaveTextContent('disk full');
    fireEvent.click(screen.getByTestId('create-athena-install-retry'));
    expect(failed.actions.retryInstall).toHaveBeenCalled();
    r3.unmount();

    const manual = engine('voice_install', { kind: 'install', engine: 'pocket_tts', state: install('manual', { engineDownloadUrl: 'https://e', modelDownloadUrl: 'https://m' }) });
    render(<CreateAthenaConversation engine={manual} />);
    fireEvent.click(screen.getByTestId('create-athena-install-engine-link'));
    expect(openExternalUrl).toHaveBeenCalledWith('https://e');
    fireEvent.click(screen.getByTestId('create-athena-install-recheck'));
    expect(manual.actions.recheckInstall).toHaveBeenCalled();
  });

  it('install: completed shows done + Continue', () => {
    const e = engine('voice_install', { kind: 'install', engine: 'kokoro', state: install('completed') });
    render(<CreateAthenaConversation engine={e} />);
    expect(screen.getByTestId('create-athena-install-done')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('create-athena-next'));
    expect(e.actions.next).toHaveBeenCalled();
  });

  it('voice_pick: ghost rows while loading, rows select/preview/stop, choose gated on selection', () => {
    const loading = engine('voice_pick', { kind: 'voice_pick', engine: 'kokoro', voices: [], loading: true, selected: null, previewVoiceId: null, preview: 'idle', wokeUp: false });
    const r1 = render(<CreateAthenaConversation engine={loading} />);
    expect(screen.queryByTestId('create-athena-voice-none')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-athena-voice-choose')).toBeDisabled();
    r1.unmount();

    const e = engine('voice_pick', {
      kind: 'voice_pick', engine: 'kokoro', loading: false, selected: 'b', previewVoiceId: 'a', preview: 'playing', wokeUp: true,
      voices: [{ voiceId: 'a', label: 'Aria', meta: 'en · f' }, { voiceId: 'b', label: 'Bo', meta: null }],
    });
    render(<CreateAthenaConversation engine={e} />);
    fireEvent.click(screen.getByTestId('create-athena-voice-select-a'));
    expect(e.actions.selectVoice).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByTestId('create-athena-voice-stop-a'));
    expect(e.actions.stopPreview).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-athena-voice-play-b'));
    expect(e.actions.previewVoice).toHaveBeenCalledWith('b');
    expect(screen.getByTestId('create-athena-voice-select-b')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('create-athena-voice-choose'));
    expect(e.actions.next).toHaveBeenCalled();
  });

  it('voice_pick: empty list says so', () => {
    render(<CreateAthenaConversation engine={engine('voice_pick', { kind: 'voice_pick', engine: 'kokoro', voices: [], loading: false, selected: null, previewVoiceId: null, preview: 'idle', wokeUp: false })} />);
    expect(screen.getByTestId('create-athena-voice-none')).toBeInTheDocument();
  });

  it('stt: hold-to-talk drives start/stop, columns show takes, use picks an engine', () => {
    const e = engine('stt', {
      kind: 'stt', recording: false, busy: false, whisperInstalled: false, micError: 'no mic', picked: null,
      browser: take({ text: 'hello there', elapsedMs: 120 }),
      whisper: take(),
    }, { canNext: false });
    render(<CreateAthenaConversation engine={e} />);
    expect(screen.getByTestId('create-athena-stt-mic-error')).toHaveTextContent('no mic');
    const hold = screen.getByTestId('create-athena-stt-hold');
    fireEvent.pointerDown(hold);
    expect(e.actions.sttStart).toHaveBeenCalled();
    fireEvent.pointerUp(hold);
    expect(e.actions.sttStop).toHaveBeenCalled();
    fireEvent.keyDown(hold, { key: ' ' });
    expect(e.actions.sttStart).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('create-athena-stt-text-browser')).toHaveTextContent('hello there');
    expect(screen.getByTestId('create-athena-stt-col-browser')).toHaveTextContent('120 ms');
    expect(screen.getByTestId('create-athena-stt-text-whisper')).toHaveTextContent("Whisper isn't installed yet");
    expect(screen.getByTestId('create-athena-stt-use-whisper')).toBeDisabled();
    fireEvent.click(screen.getByTestId('create-athena-stt-use-browser'));
    expect(e.actions.sttPick).toHaveBeenCalledWith('browser');
    expect(screen.getByTestId('create-athena-next')).toBeDisabled();
  });

  it('stt: release label while recording and Space toggles stop', () => {
    const e = engine('stt', { kind: 'stt', recording: true, busy: true, whisperInstalled: true, micError: null, picked: 'whisper', browser: take({ supported: false }), whisper: take({ busy: true }) });
    render(<CreateAthenaConversation engine={e} />);
    const hold = screen.getByTestId('create-athena-stt-hold');
    expect(hold).toHaveTextContent('Release to finish');
    fireEvent.keyDown(hold, { key: ' ' });
    expect(e.actions.sttStop).toHaveBeenCalled();
    expect(screen.getByTestId('create-athena-stt-text-browser')).toHaveTextContent('Not available in this window');
    expect(screen.getByTestId('create-athena-stt-use-whisper')).toHaveAttribute('aria-pressed', 'true');
  });

  it('handoff: open → finish(), no-login caption, waveform present, no Skip link', () => {
    const e = engine('handoff', { kind: 'handoff', hasClaudeLogin: false, voiceReady: true }, { speaking: true });
    render(<CreateAthenaConversation engine={e} />);
    expect(screen.getByTestId('athena-avatar')).toHaveAttribute('data-state', 'speaking');
    expect(screen.getByTestId('create-athena-handoff-no-login')).toBeInTheDocument();
    expect(screen.queryByTestId('create-athena-skip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('create-athena-handoff-open'));
    expect(e.actions.finish).toHaveBeenCalled();
  });
});
