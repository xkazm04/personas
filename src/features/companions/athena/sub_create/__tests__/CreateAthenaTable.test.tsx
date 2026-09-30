import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import CreateAthenaTable from '../variants/CreateAthenaTable';
import { FOLD_DELAY_MS } from '../variants/table/tableKeys';
import { deriveBeats, pathProgress } from '../variants/table/tableBeats';
import {
  CREATE_ATHENA_STEP_ORDER,
  type CreateAthenaActions,
  type CreateAthenaCard,
  type CreateAthenaEngine,
  type CreateAthenaStepId,
} from '../engine/createAthenaTypes';

// Same contract-only harness as the Stage test: the engine is hand-built per
// card, TypedLine reports done at once (or never, when `typing` is set), and
// the video avatar is stubbed.
let typing = false;
vi.mock('../shared/TypedLine', () => ({
  TypedLine: ({ text, onDone }: { text: string; onDone?: () => void }) => {
    useEffect(() => {
      if (!typing) onDone?.();
    }, [onDone]);
    return <p>{text}</p>;
  },
}));
vi.mock('@/features/companions/athena/AthenaAvatar', () => ({
  AthenaAvatar: () => <div data-testid="athena-avatar-stub" />,
}));

function actions(): CreateAthenaActions {
  const names = ['next', 'back', 'skip', 'goTo', 'restart', 'keepFeature', 'confirmOrbPlace', 'replayChime', 'selectEngine', 'confirmEngine', 'startInstall', 'retryInstall', 'recheckInstall', 'selectVoice', 'previewVoice', 'stopPreview', 'sttStart', 'sttStop', 'sttPick', 'finish'];
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as CreateAthenaActions;
}

function engineFor(card: CreateAthenaCard, stepId: CreateAthenaStepId, over: Partial<CreateAthenaEngine> = {}): CreateAthenaEngine {
  const stepIndex = CREATE_ATHENA_STEP_ORDER.indexOf(stepId);
  return {
    stepId,
    stepIndex,
    stepCount: CREATE_ATHENA_STEP_ORDER.length,
    steps: CREATE_ATHENA_STEP_ORDER.map((id, i) => ({ id, status: i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo' })),
    line: { id: `line-${stepId}`, text: `Line for ${stepId}` },
    card,
    speaking: false,
    canNext: false,
    canBack: stepIndex > 0,
    actions: actions(),
    ...over,
  };
}

const keepCard: CreateAthenaCard = { kind: 'keep_toggle', feature: 'orb', enabled: true, recommended: 'keep', why: 'Why', choice: null };

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  typing = false;
});

describe('CreateAthenaTable', () => {
  it('folds a settling pick: records the choice, then advances after a beat', () => {
    vi.useFakeTimers();
    const engine = engineFor(keepCard, 'orb');
    render(<CreateAthenaTable engine={engine} />);
    fireEvent.click(screen.getByTestId('create-athena-keep'));
    expect(engine.actions.keepFeature).toHaveBeenCalledWith('orb', true);
    expect(engine.actions.next).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(FOLD_DELAY_MS));
    expect(engine.actions.next).toHaveBeenCalledTimes(1);
  });

  it('shows a receipt for every answered step, and "change" reopens that step', () => {
    const engine = engineFor(keepCard, 'orb');
    render(<CreateAthenaTable engine={engine} />);
    expect(screen.getByTestId('create-athena-table-receipt-intro')).toBeTruthy();
    expect(screen.getByTestId('create-athena-table-receipt-footer_icon')).toBeTruthy();
    expect(screen.queryByTestId('create-athena-table-receipt-orb')).toBeNull();
    fireEvent.click(screen.getByTestId('create-athena-table-change-footer_icon'));
    expect(engine.actions.goTo).toHaveBeenCalledWith('footer_icon');
  });

  it('answers the keyboard: a digit picks, Enter continues, ? opens the list', () => {
    const engine = engineFor(keepCard, 'orb');
    render(<CreateAthenaTable engine={engine} />);
    const root = screen.getByTestId('create-athena-table');
    fireEvent.keyDown(root, { key: '2' });
    expect(engine.actions.keepFeature).toHaveBeenCalledWith('orb', false);
    fireEvent.keyDown(root, { key: '?' });
    expect(screen.getByTestId('create-athena-table-keys-sheet')).toBeTruthy();
  });

  it('starts on Enter from the intro, which has no card', () => {
    const engine = engineFor({ kind: 'intro', mode: 'fresh' }, 'intro');
    render(<CreateAthenaTable engine={engine} />);
    expect(screen.queryByTestId('create-athena-card-intro')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('create-athena-table'), { key: 'Enter' });
    expect(engine.actions.next).toHaveBeenCalledTimes(1);
  });

  it('keeps the card and its keys inert while her line is still typing', () => {
    typing = true;
    const engine = engineFor(keepCard, 'orb');
    render(<CreateAthenaTable engine={engine} />);
    expect(screen.queryByTestId('create-athena-card-keep_toggle')).toBeNull();
    fireEvent.keyDown(screen.getByTestId('create-athena-table'), { key: '1' });
    expect(engine.actions.keepFeature).not.toHaveBeenCalled();
  });

  it('writes her card from decided steps; a decided line is a way back', () => {
    const engine = engineFor({ kind: 'stt', recording: false, busy: false, browser: { supported: true, busy: false, text: '', interim: '', error: null, elapsedMs: null }, whisper: { supported: true, busy: false, text: '', interim: '', error: null, elapsedMs: null }, whisperInstalled: false, micError: null, picked: null }, 'stt');
    render(<CreateAthenaTable engine={engine} />);
    fireEvent.click(screen.getByTestId('create-athena-table-card-chime'));
    expect(engine.actions.goTo).toHaveBeenCalledWith('chime');
    expect(screen.getByTestId('create-athena-table-card-stt').tagName).toBe('SPAN');
  });
});

describe('tableBeats', () => {
  it('opens the beat that holds the current step and fills the path behind it', () => {
    const steps = CREATE_ATHENA_STEP_ORDER.map((id) => ({ id, status: id === 'voice_pick' ? ('current' as const) : CREATE_ATHENA_STEP_ORDER.indexOf(id) < CREATE_ATHENA_STEP_ORDER.indexOf('voice_pick') ? ('done' as const) : ('todo' as const) }));
    const beats = deriveBeats(steps);
    expect(beats.map((b) => b.status)).toEqual(['done', 'done', 'now', 'todo', 'todo']);
    expect(pathProgress(beats)).toBe(0.5);
  });
});
