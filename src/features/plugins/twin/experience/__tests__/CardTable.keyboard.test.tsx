/**
 * The table's keys, driven through the REAL `useTurn` — digits pick, Enter
 * plays, E takes the picked card into the composer, S skips — plus the two
 * rules that keep a turn honest, exercised end to end rather than in isolation.
 *
 * The i18n layer is deliberately NOT mocked. A hand-built translation tree
 * passes whatever the test author remembered to put in it; the real catalog
 * fails the moment a key the surface reads does not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SetupSessionApi, SetupVoiceApi } from '../../setup/setupContract';
import { CardTable } from '../table/CardTable';
import { useTurn } from '../table/useTurn';

vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/silentCatch');
  return { ...actual, toastCatch: () => () => {}, silentCatch: () => () => {} };
});

function session(over: Partial<SetupSessionApi> = {}): SetupSessionApi {
  return {
    stage: 'setup',
    values: {},
    focus: 'identity',
    checklist: [
      { id: 'identity', status: 'empty', detail: '0/50', labelKey: 'identity' },
      { id: 'tone', status: 'empty', detail: '0/1', labelKey: 'tone' },
      { id: 'channels', status: 'empty', detail: '0/0', labelKey: 'channels' },
      { id: 'memories', status: 'empty', detail: '0/5', labelKey: 'memories' },
    ],
    score: 0,
    question: 'What do you tell people you do?',
    answerMode: 'pick',
    incoming: null,
    toneChannel: null,
    suggestions: [
      { text: 'I ship tools.', reason: 'short' },
      { text: 'I write for a living.', reason: 'clear' },
      { text: 'I run a small studio.', reason: 'specific' },
    ],
    proposals: [],
    history: [],
    busy: false,
    generatorError: null,
    toneChannels: ['generic'],
    answer: vi.fn().mockResolvedValue(undefined),
    accept: vi.fn().mockResolvedValue(undefined),
    dismiss: vi.fn(),
    edit: vi.fn().mockResolvedValue(undefined),
    skip: vi.fn().mockResolvedValue(undefined),
    redeal: vi.fn(),
    focusOn: vi.fn(),
    setStage: vi.fn(),
    topic: null,
    topicPreset: null,
    setTopic: vi.fn(),
    ...over,
  };
}

const voice: SetupVoiceApi = {
  supported: false,
  listening: false,
  interim: '',
  error: null,
  speakEnabled: false,
  handsFree: false,
  start: vi.fn(),
  stop: vi.fn(),
  toggleSpeak: vi.fn(),
  toggleHandsFree: vi.fn(),
  speak: vi.fn(),
};

/** The table as it is really mounted: its turn comes from `useTurn`. */
function Table({ api }: { api: SetupSessionApi }) {
  const turn = useTurn(api);
  return <CardTable session={api} voice={voice} turn={turn} topicLabel={null} />;
}

describe('the table keys', () => {
  beforeEach(() => vi.clearAllMocks());

  it('digits pick a card and Enter plays it through session.answer', () => {
    const api = session();
    render(<Table api={api} />);
    const desk = screen.getByTestId('setup-desk');
    desk.focus();
    fireEvent.keyDown(desk, { key: '2' });
    expect(screen.getByTestId('setup-desk-suggestion-2')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(desk, { key: 'Enter' });
    expect(api.answer).toHaveBeenCalledWith('I write for a living.');
  });

  it('S skips through session.skip and never writes a value', () => {
    const api = session();
    render(<Table api={api} />);
    const desk = screen.getByTestId('setup-desk');
    desk.focus();
    fireEvent.keyDown(desk, { key: 's' });
    expect(api.skip).toHaveBeenCalledTimes(1);
    expect(api.answer).not.toHaveBeenCalled();
  });

  it('E copies the picked card into the composer without answering', () => {
    const api = session();
    render(<Table api={api} />);
    const desk = screen.getByTestId('setup-desk');
    desk.focus();
    fireEvent.keyDown(desk, { key: '3' });
    fireEvent.keyDown(desk, { key: 'e' });
    const composer = screen.getByTestId('setup-desk-composer') as HTMLTextAreaElement;
    expect(composer.value).toBe('I run a small studio.');
    expect(api.answer).not.toHaveBeenCalled();
  });

  it('a second Enter on the same question is dropped — one verdict per turn', () => {
    const api = session();
    render(<Table api={api} />);
    const desk = screen.getByTestId('setup-desk');
    desk.focus();
    fireEvent.keyDown(desk, { key: 'Enter' });
    fireEvent.keyDown(desk, { key: 'Enter' });
    expect(api.answer).toHaveBeenCalledTimes(1);
  });

  it('a write turn deals no cards at all — its answer has to be typed', () => {
    const api = session({ answerMode: 'write', incoming: 'Hey, are you free Thursday?' });
    render(<Table api={api} />);
    expect(screen.queryByTestId('setup-desk-suggestion-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('setup-desk-incoming')).toBeInTheDocument();
    expect(screen.getByTestId('setup-desk-composer')).toBeInTheDocument();
  });
});
