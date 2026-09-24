import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { SetupSessionApi, SetupVoiceApi } from '../../../setup/setupContract';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: T,
    tx: (s: string, vars?: Record<string, string | number>) =>
      s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars?.[k] ?? '')),
    language: 'en',
  }),
}));

vi.mock('@/lib/silentCatch', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/lib/silentCatch');
  return { ...actual, toastCatch: () => () => {}, silentCatch: () => () => {} };
});

const slot = { label: 'Identity', hint: 'who you are' };
const T = {
  twin: {
    experience_grok: {
      table: {
        greeting: "We'll walk {items}.",
        noQuestion: 'clear',
        composerPlaceholder: 'write',
        send: 'Play',
        thinking: 'dealing',
        legendPick: '1-3',
        legendAccept: 'Enter',
        legendEdit: 'E',
        legendSkip: 'S',
        skip: 'Skip',
        pickCard: 'Pick',
        earlier: '{count} earlier',
        earlierHide: 'Hide',
        skipped: 'Skipped',
      },
      slots: {
        identity: slot,
        tone: { label: 'Voice', hint: 'h' },
        channels: { label: 'Channels', hint: 'h' },
        memories: { label: 'Memories', hint: 'h' },
      },
      voice: { dictate: 'Dictate', stop: 'Stop' },
    },
    setup: {
      proposal: {
        accept: 'Accept',
        edit: 'Edit',
        dismiss: 'Dismiss',
        accepted: 'Accepted',
        edited: 'Edited',
        dismissed: 'Dismissed',
        kind: { bio: 'Bio', role: 'Role', tone: 'Tone' },
      },
    },
  },
};

import { CardTable } from '../table/CardTable';

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

describe('CardTable keyboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('digits pick a card, Enter plays it through session.answer', () => {
    const api = session();
    render(<CardTable session={api} voice={voice} onOpenHub={vi.fn()} />);
    const desk = screen.getByTestId('setup-desk');
    desk.focus();
    fireEvent.keyDown(desk, { key: '2' });
    expect(screen.getByTestId('setup-desk-suggestion-2')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.keyDown(desk, { key: 'Enter' });
    expect(api.answer).toHaveBeenCalledWith('I write for a living.');
  });

  it('S skips through session.skip and never writes a value', () => {
    const api = session();
    render(<CardTable session={api} voice={voice} onOpenHub={vi.fn()} />);
    const desk = screen.getByTestId('setup-desk');
    desk.focus();
    fireEvent.keyDown(desk, { key: 's' });
    expect(api.skip).toHaveBeenCalledTimes(1);
    expect(api.answer).not.toHaveBeenCalled();
  });

  it('E copies the picked card into the composer', () => {
    const api = session();
    render(<CardTable session={api} voice={voice} onOpenHub={vi.fn()} />);
    const desk = screen.getByTestId('setup-desk');
    desk.focus();
    fireEvent.keyDown(desk, { key: '3' });
    fireEvent.keyDown(desk, { key: 'e' });
    const composer = screen.getByTestId('setup-desk-composer') as HTMLTextAreaElement | HTMLInputElement;
    expect(composer.value).toBe('I run a small studio.');
    expect(api.answer).not.toHaveBeenCalled();
  });
});
