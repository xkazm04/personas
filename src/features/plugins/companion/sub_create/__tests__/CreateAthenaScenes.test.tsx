import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useEffect } from 'react';
import CreateAthenaScenes from '../variants/CreateAthenaScenes';
import {
  CREATE_ATHENA_STEP_ORDER,
  type CreateAthenaActions,
  type CreateAthenaCard,
  type CreateAthenaEngine,
} from '../engine/createAthenaTypes';
import type { EngineTake } from '../../useSttComparison';

// The WP0 TypedLine stub never reports `onDone`, and the card only reveals
// after it does — so the shell is tested against a line that lands at once.
vi.mock('../shared/TypedLine', () => ({
  TypedLine: ({ text, onDone }: { text: string; onDone?: () => void }) => {
    useEffect(() => {
      onDone?.();
    }, [onDone]);
    return <p>{text}</p>;
  },
}));
// Video avatar: jsdom has no media pipeline and the shell only passes state.
vi.mock('@/features/plugins/companion/AthenaAvatar', () => ({
  AthenaAvatar: ({ state }: { state: string }) => <div data-testid="avatar" data-state={state} />,
}));
const openExternalUrl = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('@/api/system/system', () => ({ openExternalUrl }));

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

function engine(card: CreateAthenaCard, over: Partial<CreateAthenaEngine> = {}): CreateAthenaEngine {
  return {
    stepId: 'intro',
    stepIndex: 0,
    stepCount: CREATE_ATHENA_STEP_ORDER.length,
    steps: CREATE_ATHENA_STEP_ORDER.map((id, i) => ({ id, status: i === 0 ? 'current' : 'todo' })),
    line: { id: `line-${card.kind}`, text: `Line for ${card.kind}` },
    card,
    speaking: false,
    canNext: true,
    canBack: false,
    actions: actions(),
    ...over,
  };
}

function take(over: Partial<EngineTake> = {}): EngineTake {
  return { supported: true, busy: false, text: '', interim: '', error: null, elapsedMs: null, ...over };
}

beforeEach(() => vi.clearAllMocks());

describe('CreateAthenaScenes — shell', () => {
  it('fills its parent without fixed positioning and shows the line', () => {
    render(<CreateAthenaScenes engine={engine({ kind: 'intro', mode: 'fresh' })} />);
    const root = screen.getByTestId('create-athena-scenes');
    expect(root.className).not.toMatch(/\bfixed\b/);
    expect(root.className).not.toMatch(/inset-0/);
    expect(root).toHaveTextContent('Line for intro');
    expect(screen.getByTestId('create-athena-dots')).toHaveAttribute('aria-label', 'Step 1 of 10');
  });

  it('ArrowRight advances only when canNext; ArrowLeft goes back only when canBack', () => {
    const e = engine({ kind: 'intro', mode: 'fresh' }, { canNext: false, canBack: false });
    const { rerender } = render(<CreateAthenaScenes engine={e} />);
    const root = screen.getByTestId('create-athena-scenes');
    fireEvent.keyDown(root, { key: 'ArrowRight' });
    fireEvent.keyDown(root, { key: 'ArrowLeft' });
    expect(e.actions.next).not.toHaveBeenCalled();
    expect(e.actions.back).not.toHaveBeenCalled();

    const e2 = engine({ kind: 'intro', mode: 'fresh' }, { canNext: true, canBack: true, stepIndex: 2 });
    rerender(<CreateAthenaScenes engine={e2} />);
    fireEvent.keyDown(screen.getByTestId('create-athena-scenes'), { key: 'ArrowRight' });
    fireEvent.keyDown(screen.getByTestId('create-athena-scenes'), { key: 'ArrowLeft' });
    expect(e2.actions.next).toHaveBeenCalledTimes(1);
    expect(e2.actions.back).toHaveBeenCalledTimes(1);
  });

  it('ignores arrow keys typed inside a control', () => {
    const e = engine({ kind: 'intro', mode: 'fresh' });
    render(<CreateAthenaScenes engine={e} />);
    fireEvent.keyDown(screen.getByTestId('create-athena-next'), { key: 'ArrowRight' });
    expect(e.actions.next).not.toHaveBeenCalled();
  });

  it('shows Back only when canBack and disables Continue until canNext', () => {
    render(<CreateAthenaScenes engine={engine({ kind: 'intro', mode: 'fresh' }, { canNext: false })} />);
    expect(screen.queryByTestId('create-athena-back')).not.toBeInTheDocument();
    expect(screen.getByTestId('create-athena-next')).toBeDisabled();
  });
});

describe('CreateAthenaScenes — cards', () => {
  it('intro: start, resume and the done-mode skip-all', () => {
    const fresh = engine({ kind: 'intro', mode: 'fresh' });
    const { rerender } = render(<CreateAthenaScenes engine={fresh} />);
    expect(screen.getByTestId('create-athena-card-intro')).toBeInTheDocument();
    expect(screen.getByTestId('create-athena-start')).toHaveTextContent("Let's go");
    expect(screen.queryByTestId('create-athena-skip-all')).not.toBeInTheDocument();

    rerender(<CreateAthenaScenes engine={engine({ kind: 'intro', mode: 'resume' })} />);
    expect(screen.getByTestId('create-athena-start')).toHaveTextContent('Pick up');

    const done = engine({ kind: 'intro', mode: 'done' });
    rerender(<CreateAthenaScenes engine={done} />);
    fireEvent.click(screen.getByTestId('create-athena-skip-all'));
    expect(done.actions.finish).toHaveBeenCalled();
  });

  it('keep_toggle: tiles reflect the choice and flip the feature', () => {
    const e = engine({ kind: 'keep_toggle', feature: 'orb', enabled: true, recommended: 'keep', why: 'because', choice: 'keep' });
    render(<CreateAthenaScenes engine={e} />);
    expect(screen.getByTestId('create-athena-card-keep_toggle')).toBeInTheDocument();
    expect(screen.getByTestId('create-athena-keep')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('create-athena-keep')).toHaveTextContent('Recommended');
    expect(screen.getByTestId('create-athena-keep')).toHaveTextContent('because');
    fireEvent.click(screen.getByTestId('create-athena-turn-off'));
    expect(e.actions.keepFeature).toHaveBeenCalledWith('orb', false);
  });

  it('orb_place: confirms the spot', () => {
    const e = engine({ kind: 'orb_place', confirmed: false });
    render(<CreateAthenaScenes engine={e} />);
    fireEvent.click(screen.getByTestId('create-athena-orb-place-done'));
    expect(e.actions.confirmOrbPlace).toHaveBeenCalled();
  });

  it('engine_pick: selects a tile and confirms', () => {
    const e = engine({
      kind: 'engine_pick',
      options: [
        { id: 'kokoro', installed: true, canAutoInstall: true },
        { id: 'pocket_tts', installed: false, canAutoInstall: true },
      ],
      selected: 'kokoro',
      recommended: 'kokoro',
      why: 'fast',
      confirmed: false,
    });
    render(<CreateAthenaScenes engine={e} />);
    expect(screen.getByTestId('create-athena-engine-kokoro')).toHaveTextContent('Installed');
    expect(screen.getByTestId('create-athena-engine-pocket_tts')).toHaveTextContent('Needs install');
    fireEvent.click(screen.getByTestId('create-athena-engine-pocket_tts'));
    expect(e.actions.selectEngine).toHaveBeenCalledWith('pocket_tts');
    fireEvent.click(screen.getByTestId('create-athena-engine-choose'));
    expect(e.actions.confirmEngine).toHaveBeenCalled();
  });

  it('install: every phase renders its own control', () => {
    const base = { engineDownloadUrl: null, modelDownloadUrl: null, error: null, bytesDownloaded: 0, bytesTotal: null };
    const idle = engine({ kind: 'install', engine: 'kokoro', state: { ...base, phase: 'idle' } });
    const { rerender } = render(<CreateAthenaScenes engine={idle} />);
    fireEvent.click(screen.getByTestId('create-athena-install-start'));
    expect(idle.actions.startInstall).toHaveBeenCalled();

    rerender(
      <CreateAthenaScenes
        engine={engine({ kind: 'install', engine: 'kokoro', state: { ...base, phase: 'downloading_model', bytesDownloaded: 50, bytesTotal: 200 } })}
      />,
    );
    expect(screen.getByTestId('create-athena-install-progress')).toHaveTextContent('Downloading model');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');

    const failed = engine({ kind: 'install', engine: 'kokoro', state: { ...base, phase: 'failed', error: 'disk full' } });
    rerender(<CreateAthenaScenes engine={failed} />);
    expect(screen.getByTestId('create-athena-install-error')).toHaveTextContent('disk full');
    fireEvent.click(screen.getByTestId('create-athena-install-retry'));
    expect(failed.actions.retryInstall).toHaveBeenCalled();

    const manual = engine({
      kind: 'install',
      engine: 'pocket_tts',
      state: { ...base, phase: 'manual', engineDownloadUrl: 'https://x/engine', modelDownloadUrl: null },
    });
    rerender(<CreateAthenaScenes engine={manual} />);
    fireEvent.click(screen.getByText('Download engine'));
    expect(openExternalUrl).toHaveBeenCalledWith('https://x/engine');
    expect(screen.queryByText('Download model')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('create-athena-install-recheck'));
    expect(manual.actions.recheckInstall).toHaveBeenCalled();

    rerender(<CreateAthenaScenes engine={engine({ kind: 'install', engine: 'kokoro', state: { ...base, phase: 'completed' } })} />);
    expect(screen.getByTestId('create-athena-install-done')).toBeInTheDocument();
  });

  it('voice_pick: ghosts while loading, says so when empty, previews and selects', () => {
    const loading = engine({ kind: 'voice_pick', engine: 'kokoro', voices: [], loading: true, selected: null, previewVoiceId: null, preview: 'idle', wokeUp: false });
    const { rerender } = render(<CreateAthenaScenes engine={loading} />);
    expect(screen.getAllByTestId('create-athena-voice-ghost').length).toBeGreaterThan(0);
    expect(screen.getByTestId('create-athena-voice-choose')).toBeDisabled();

    rerender(<CreateAthenaScenes engine={engine({ ...loading.card, loading: false })} />);
    expect(screen.getByTestId('create-athena-voice-none')).toBeInTheDocument();

    const voices = [
      { voiceId: 'a', label: 'Aria', meta: 'en · f' },
      { voiceId: 'b', label: 'Bo', meta: null },
    ];
    const listed = engine({ ...loading.card, loading: false, voices, selected: 'a', previewVoiceId: 'b', preview: 'playing' });
    rerender(<CreateAthenaScenes engine={listed} />);
    expect(screen.getByTestId('create-athena-voice-select-a')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('create-athena-voice-play-a'));
    expect(listed.actions.previewVoice).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByTestId('create-athena-voice-play-b'));
    expect(listed.actions.stopPreview).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-athena-voice-select-b'));
    expect(listed.actions.selectVoice).toHaveBeenCalledWith('b');
    expect(screen.getByTestId('create-athena-voice-choose')).not.toBeDisabled();
  });

  it('stt: hold-to-talk drives start/stop and the panels pick an engine', () => {
    const e = engine({
      kind: 'stt',
      recording: false,
      busy: false,
      browser: take({ text: 'heard by browser', elapsedMs: 120 }),
      whisper: take(),
      whisperInstalled: false,
      micError: 'no mic',
      picked: null,
    });
    render(<CreateAthenaScenes engine={e} />);
    expect(screen.getByTestId('create-athena-stt-mic-error')).toHaveTextContent('no mic');
    const hold = screen.getByTestId('create-athena-stt-hold');
    fireEvent.pointerDown(hold);
    expect(e.actions.sttStart).toHaveBeenCalled();
    fireEvent.pointerUp(hold);
    expect(e.actions.sttStop).toHaveBeenCalled();
    expect(screen.getByTestId('create-athena-stt-text-browser')).toHaveTextContent('heard by browser');
    expect(screen.getByTestId('create-athena-stt-latency-browser')).toHaveTextContent('120 ms');
    expect(screen.getByTestId('create-athena-stt-text-whisper')).toHaveTextContent("isn't installed");
    expect(screen.getByTestId('create-athena-stt-use-whisper')).toBeDisabled();
    fireEvent.click(screen.getByTestId('create-athena-stt-use-browser'));
    expect(e.actions.sttPick).toHaveBeenCalledWith('browser');
  });

  it('handoff: opens the chat and names the missing login', () => {
    const e = engine({ kind: 'handoff', hasClaudeLogin: false, voiceReady: true });
    render(<CreateAthenaScenes engine={e} />);
    expect(screen.getByTestId('create-athena-handoff-no-login')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('create-athena-handoff-open'));
    expect(e.actions.finish).toHaveBeenCalled();
  });
});
