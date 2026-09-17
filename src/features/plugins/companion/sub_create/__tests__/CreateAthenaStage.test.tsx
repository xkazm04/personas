import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import CreateAthenaStage from '../variants/CreateAthenaStage';
import {
  CREATE_ATHENA_STEP_ORDER,
  type CreateAthenaActions,
  type CreateAthenaCard,
  type CreateAthenaEngine,
  type CreateAthenaStepId,
} from '../engine/createAthenaTypes';
import type { EngineTake } from '../../useSttComparison';

// The shell is built against the contract alone: the engine is hand-built
// per card kind here. `TypedLine` is replaced by a stub that reports done
// synchronously so the card is on screen without waiting for typing; the
// video avatar is stubbed because jsdom has no <video> playback.
vi.mock('../shared/TypedLine', () => ({
  TypedLine: ({ text, onDone }: { text: string; onDone?: () => void }) => {
    useEffect(() => {
      onDone?.();
    }, [onDone]);
    return <p>{text}</p>;
  },
}));
vi.mock('@/features/plugins/companion/AthenaAvatar', () => ({
  AthenaAvatar: () => <div data-testid="athena-avatar-stub" />,
}));

function actions(): CreateAthenaActions {
  return {
    next: vi.fn(),
    back: vi.fn(),
    skip: vi.fn(),
    goTo: vi.fn(),
    restart: vi.fn(),
    keepFeature: vi.fn(),
    confirmOrbPlace: vi.fn(),
    selectEngine: vi.fn(),
    confirmEngine: vi.fn(),
    startInstall: vi.fn(),
    retryInstall: vi.fn(),
    recheckInstall: vi.fn(),
    selectVoice: vi.fn(),
    previewVoice: vi.fn(),
    stopPreview: vi.fn(),
    sttStart: vi.fn(),
    sttStop: vi.fn(),
    sttPick: vi.fn(),
    finish: vi.fn(),
  };
}

function engineFor(
  card: CreateAthenaCard,
  stepId: CreateAthenaStepId,
  over: Partial<CreateAthenaEngine> = {},
): CreateAthenaEngine {
  const stepIndex = CREATE_ATHENA_STEP_ORDER.indexOf(stepId);
  return {
    stepId,
    stepIndex,
    stepCount: CREATE_ATHENA_STEP_ORDER.length,
    steps: CREATE_ATHENA_STEP_ORDER.map((id, i) => ({
      id,
      status: i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo',
    })),
    line: { id: `line-${stepId}`, text: `Line for ${stepId}` },
    card,
    speaking: false,
    canNext: false,
    canBack: stepIndex > 0,
    actions: actions(),
    ...over,
  };
}

function take(over: Partial<EngineTake> = {}): EngineTake {
  return { supported: true, busy: false, text: '', interim: '', error: null, elapsedMs: null, ...over };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => cleanup());

describe('CreateAthenaStage', () => {
  it('renders the rail with every step and the current line', () => {
    const engine = engineFor({ kind: 'intro', mode: 'fresh' }, 'intro', { canNext: true });
    render(<CreateAthenaStage engine={engine} />);
    expect(screen.getByTestId('create-athena-stage')).toBeInTheDocument();
    for (const id of CREATE_ATHENA_STEP_ORDER) {
      expect(screen.getByTestId(`create-athena-rail-step-${id}`)).toBeInTheDocument();
    }
    expect(screen.getByText('Line for intro')).toBeInTheDocument();
    expect(screen.getByTestId('create-athena-card-intro')).toBeInTheDocument();
  });

  it('rail rows fire goTo only for done and skipped steps', () => {
    const engine = engineFor({ kind: 'orb_place', confirmed: false }, 'orb_place');
    engine.steps[1] = { id: 'footer_icon', status: 'skipped' };
    render(<CreateAthenaStage engine={engine} />);
    fireEvent.click(screen.getByTestId('create-athena-rail-step-intro'));
    fireEvent.click(screen.getByTestId('create-athena-rail-step-footer_icon'));
    fireEvent.click(screen.getByTestId('create-athena-rail-step-orb_place'));
    fireEvent.click(screen.getByTestId('create-athena-rail-step-stt'));
    expect(engine.actions.goTo).toHaveBeenCalledTimes(2);
    expect(engine.actions.goTo).toHaveBeenCalledWith('intro');
    expect(engine.actions.goTo).toHaveBeenCalledWith('footer_icon');
    expect(screen.getByTestId('create-athena-rail-step-orb_place').tagName).toBe('LI');
    expect(screen.getByTestId('create-athena-rail-step-orb_place')).toHaveAttribute('aria-current', 'step');
  });

  it('intro: start advances; done mode offers skip-all; restart lives on the rail', () => {
    const engine = engineFor({ kind: 'intro', mode: 'done' }, 'intro', { canNext: true });
    render(<CreateAthenaStage engine={engine} />);
    fireEvent.click(screen.getByTestId('create-athena-start'));
    expect(engine.actions.next).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-athena-skip-all'));
    expect(engine.actions.finish).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-athena-restart'));
    expect(engine.actions.restart).toHaveBeenCalled();
    // The intro owns its primary: no footer Continue / Skip.
    expect(screen.queryByTestId('create-athena-next')).not.toBeInTheDocument();
  });

  it('keep_toggle: toggle and buttons record the choice; Continue waits for canNext', () => {
    const engine = engineFor(
      { kind: 'keep_toggle', feature: 'orb', enabled: true, recommended: 'keep', why: 'because', choice: null },
      'orb',
    );
    render(<CreateAthenaStage engine={engine} />);
    expect(screen.getByTestId('create-athena-card-keep_toggle')).toHaveTextContent('because');
    fireEvent.click(screen.getByTestId('create-athena-keep-toggle'));
    expect(engine.actions.keepFeature).toHaveBeenCalledWith('orb', false);
    fireEvent.click(screen.getByTestId('create-athena-turn-off'));
    expect(engine.actions.keepFeature).toHaveBeenCalledWith('orb', false);
    fireEvent.click(screen.getByTestId('create-athena-keep'));
    expect(engine.actions.keepFeature).toHaveBeenCalledWith('orb', true);
    expect(screen.getByTestId('create-athena-next')).toBeDisabled();
    fireEvent.click(screen.getByTestId('create-athena-skip'));
    expect(engine.actions.skip).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-athena-back'));
    expect(engine.actions.back).toHaveBeenCalled();
  });

  it('orb_place confirms', () => {
    const engine = engineFor({ kind: 'orb_place', confirmed: false }, 'orb_place');
    render(<CreateAthenaStage engine={engine} />);
    fireEvent.click(screen.getByTestId('create-athena-orb-place-done'));
    expect(engine.actions.confirmOrbPlace).toHaveBeenCalled();
  });

  it('engine_pick: tiles select, choose confirms', () => {
    const engine = engineFor(
      {
        kind: 'engine_pick',
        options: [
          { id: 'kokoro', installed: true, canAutoInstall: true },
          { id: 'pocket_tts', installed: false, canAutoInstall: true },
        ],
        selected: 'kokoro',
        recommended: 'kokoro',
        why: 'fast',
        confirmed: false,
      },
      'voice_engine',
    );
    render(<CreateAthenaStage engine={engine} />);
    expect(screen.getByTestId('create-athena-engine-kokoro')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('create-athena-engine-pocket_tts'));
    expect(engine.actions.selectEngine).toHaveBeenCalledWith('pocket_tts');
    fireEvent.click(screen.getByTestId('create-athena-engine-choose'));
    expect(engine.actions.confirmEngine).toHaveBeenCalled();
  });

  it('install: renders every phase', () => {
    const base = { bytesDownloaded: 0, bytesTotal: null, error: null, engineDownloadUrl: null, modelDownloadUrl: null };
    const mk = (state: Extract<CreateAthenaCard, { kind: 'install' }>['state']) =>
      engineFor({ kind: 'install', engine: 'kokoro', state }, 'voice_install');

    const idle = mk({ ...base, phase: 'idle' });
    const r1 = render(<CreateAthenaStage engine={idle} />);
    fireEvent.click(screen.getByTestId('create-athena-install-start'));
    expect(idle.actions.startInstall).toHaveBeenCalled();
    r1.unmount();

    const r2 = render(
      <CreateAthenaStage engine={mk({ ...base, phase: 'downloading_model', bytesDownloaded: 50, bytesTotal: 200 })} />,
    );
    expect(screen.getByTestId('create-athena-install-progress')).toHaveTextContent('25');
    r2.unmount();

    const failed = mk({ ...base, phase: 'failed', error: 'disk full' });
    const r3 = render(<CreateAthenaStage engine={failed} />);
    expect(screen.getByTestId('create-athena-install-failed')).toHaveTextContent('disk full');
    fireEvent.click(screen.getByTestId('create-athena-install-retry'));
    expect(failed.actions.retryInstall).toHaveBeenCalled();
    r3.unmount();

    const manual = mk({ ...base, phase: 'manual', engineDownloadUrl: 'https://e', modelDownloadUrl: 'https://m' });
    const r4 = render(<CreateAthenaStage engine={manual} />);
    expect(screen.getByTestId('create-athena-install-manual').querySelectorAll('a[target="_blank"]')).toHaveLength(2);
    fireEvent.click(screen.getByTestId('create-athena-install-recheck'));
    expect(manual.actions.recheckInstall).toHaveBeenCalled();
    r4.unmount();

    render(<CreateAthenaStage engine={mk({ ...base, phase: 'completed' })} />);
    expect(screen.getByTestId('create-athena-install-done')).toBeInTheDocument();
  });

  it('voice_pick: ghosts while loading, empty state, tiles select / preview / stop', () => {
    const bare: Extract<CreateAthenaCard, { kind: 'voice_pick' }> = {
      kind: 'voice_pick',
      engine: 'kokoro',
      voices: [],
      loading: true,
      selected: null,
      previewVoiceId: null,
      preview: 'idle',
      wokeUp: false,
    };
    const r1 = render(<CreateAthenaStage engine={engineFor(bare, 'voice_pick')} />);
    expect(screen.getByTestId('create-athena-voice-ghost')).toBeInTheDocument();
    r1.unmount();

    const empty = engineFor({ ...bare, loading: false }, 'voice_pick');
    const r2 = render(<CreateAthenaStage engine={empty} />);
    expect(screen.getByTestId('create-athena-voice-none')).toBeInTheDocument();
    r2.unmount();

    const voices = engineFor(
      {
        kind: 'voice_pick',
        engine: 'kokoro',
        voices: [
          { voiceId: 'a', label: 'Ada', meta: 'en · f' },
          { voiceId: 'b', label: 'Bo', meta: null },
        ],
        loading: false,
        selected: 'a',
        previewVoiceId: 'b',
        preview: 'playing',
        wokeUp: true,
      },
      'voice_pick',
      { canNext: true },
    );
    render(<CreateAthenaStage engine={voices} />);
    expect(screen.getByTestId('create-athena-voice-a')).toHaveAttribute('data-selected', 'true');
    fireEvent.click(screen.getByTestId('create-athena-voice-select-b'));
    expect(voices.actions.selectVoice).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByTestId('create-athena-voice-play-a'));
    expect(voices.actions.previewVoice).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByTestId('create-athena-voice-play-b'));
    expect(voices.actions.stopPreview).toHaveBeenCalled();
    expect(screen.getByTestId('create-athena-next')).not.toBeDisabled();
  });

  it('stt: hold-to-talk drives start/stop, columns show takes, use picks', () => {
    const engine = engineFor(
      {
        kind: 'stt',
        recording: false,
        busy: false,
        browser: take({ text: 'browser heard', elapsedMs: 120 }),
        whisper: take({ supported: true }),
        whisperInstalled: false,
        micError: 'mic denied',
        picked: 'browser',
      },
      'stt',
    );
    render(<CreateAthenaStage engine={engine} />);
    expect(screen.getByTestId('create-athena-stt-mic-error')).toHaveTextContent('mic denied');
    const hold = screen.getByTestId('create-athena-stt-hold');
    fireEvent.pointerDown(hold);
    expect(engine.actions.sttStart).toHaveBeenCalled();
    fireEvent.pointerUp(hold);
    expect(engine.actions.sttStop).toHaveBeenCalled();
    expect(screen.getByTestId('create-athena-stt-text-browser')).toHaveTextContent('browser heard');
    expect(screen.getByTestId('create-athena-stt-col-browser')).toHaveTextContent('120');
    expect(screen.getByTestId('create-athena-stt-col-browser')).toHaveAttribute('data-picked', 'true');
    expect(screen.getByTestId('create-athena-stt-use-whisper')).toBeDisabled();
    fireEvent.click(screen.getByTestId('create-athena-stt-use-browser'));
    expect(engine.actions.sttPick).toHaveBeenCalledWith('browser');
  });

  it('handoff: opens the chat and explains a missing login', () => {
    const engine = engineFor({ kind: 'handoff', hasClaudeLogin: false, voiceReady: true }, 'handoff');
    render(<CreateAthenaStage engine={engine} />);
    expect(screen.getByTestId('create-athena-handoff-no-login')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('create-athena-handoff-open'));
    expect(engine.actions.finish).toHaveBeenCalled();
    expect(screen.queryByTestId('create-athena-next')).not.toBeInTheDocument();
  });
});
