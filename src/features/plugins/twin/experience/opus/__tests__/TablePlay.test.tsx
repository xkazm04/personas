/**
 * The table in play, rendered against a scripted session: the behaviours the
 * brief pins down (answers go through `answer`, one verdict per question,
 * keyboard play, write turns deal no cards, completion comes from readiness).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { SetupSessionApi, SetupVoiceApi, SetupChecklistItem } from '../../../setup/setupContract';

let storeState: Record<string, unknown> = {};
vi.mock('@/stores/systemStore', () => {
  const useSystemStore = <T,>(selector: (s: Record<string, unknown>) => T): T => selector(storeState);
  return { useSystemStore };
});

import { TablePlay, type TablePlayProps } from '../table/TablePlay';

const CHECKLIST: SetupChecklistItem[] = [
  { id: 'identity', status: 'partial', detail: '20/50', labelKey: 'identity' },
  { id: 'tone', status: 'empty', detail: '0/1', labelKey: 'tone' },
  { id: 'channels', status: 'empty', detail: '0/0', labelKey: 'channels' },
  { id: 'memories', status: 'empty', detail: '0/5', labelKey: 'memories' },
];

function session(over: Partial<SetupSessionApi> = {}): SetupSessionApi {
  return {
    stage: 'setup',
    values: { name: 'Ada', role: '', bio: '', obsidianSubpath: '', 'tone:generic': '' },
    focus: 'tone',
    checklist: CHECKLIST,
    score: 20,
    question: 'Which is more you on Slack?',
    answerMode: 'pick',
    incoming: null,
    toneChannel: 'slack',
    suggestions: [
      { text: 'Sounds good!', reason: 'keeps it bright' },
      { text: 'sg', reason: 'keeps Slack lowercase' },
      { text: 'Sounds good.', reason: 'keeps it level' },
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

function props(s: SetupSessionApi, over: Partial<TablePlayProps> = {}): TablePlayProps {
  return {
    session: s,
    voice,
    twinName: 'Ada',
    fresh: false,
    dock: {
      studio: { phase: 'browse', chosen: null } as unknown as TablePlayProps['dock']['studio'],
      currentTones: [],
    },
    coverage: [],
    momentum: { sessions: 0, lastTrainedAt: null },
    onPickTopic: vi.fn(),
    onStartTraining: vi.fn(),
    onOpenStyle: vi.fn(),
    onOpenFields: vi.fn(),
    onOpenHub: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  storeState = { activeTwinId: 't1', twinProfiles: [{ id: 't1', name: 'Ada', pronouns: 'neutral' }] };
});

describe('the table in play', () => {
  it('deals the question and its three cards; press to pick, press again to play, once', async () => {
    const s = session();
    render(<TablePlay {...props(s)} />);
    expect(screen.getByTestId('xo-dealer-question').textContent).toBe('Which is more you on Slack?');

    fireEvent.click(screen.getByTestId('xo-card-2'));
    expect(s.answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('xo-card-2'));
    // A third press on a card already flying out must not answer again.
    fireEvent.click(screen.getByTestId('xo-card-2'));
    await act(async () => {});

    expect(s.answer).toHaveBeenCalledTimes(1);
    expect(s.answer).toHaveBeenCalledWith('sg');
  });

  it('plays from the keyboard: a digit picks, Enter plays', async () => {
    const s = session();
    render(<TablePlay {...props(s)} />);
    const table = screen.getByTestId('xo-table');
    fireEvent.keyDown(table, { key: '3' });
    fireEvent.keyDown(table, { key: 'Enter' });
    await act(async () => {});
    expect(s.answer).toHaveBeenCalledWith('Sounds good.');
  });

  it('S skips through the session and nothing is answered', async () => {
    const s = session();
    render(<TablePlay {...props(s)} />);
    fireEvent.keyDown(screen.getByTestId('xo-table'), { key: 's' });
    await act(async () => {});
    expect(s.skip).toHaveBeenCalledTimes(1);
    expect(s.answer).not.toHaveBeenCalled();
  });

  it('a write turn deals no cards and shows the message being replied to', () => {
    const s = session({ answerMode: 'write', incoming: 'can we push to thursday?', suggestions: [] });
    render(<TablePlay {...props(s)} />);
    expect(screen.queryByTestId('xo-card-1')).toBeNull();
    expect(screen.getByTestId('xo-dealer-incoming').textContent).toContain('can we push to thursday?');
    expect(screen.getByTestId('xo-dealer-incoming').textContent).toContain('Slack');
    expect(screen.getByTestId('xo-composer-card')).toBeTruthy();
  });

  it('an offered sample is labelled as the person\'s own words and kept through accept', async () => {
    const offer = {
      id: 'sample-1',
      kind: 'tone' as const,
      part: 'examples' as const,
      channel: 'slack',
      value: 'yep thursday works',
      lengthHint: null,
      reason: '',
    };
    const s = session({ proposals: [offer] });
    render(<TablePlay {...props(s)} />);
    const card = screen.getByTestId('xo-loot-examples');
    expect(card.textContent).toContain('Slack');
    expect(card.textContent).toContain('yep thursday works');
    await act(async () => {
      fireEvent.click(screen.getByTestId('xo-loot-keep'));
    });
    expect(s.accept).toHaveBeenCalledWith(offer);
  });

  it('when every suit is set, readiness hands out the reward card', () => {
    const done = CHECKLIST.map((c) => ({ ...c, status: 'set' as const }));
    render(<TablePlay {...props(session({ checklist: done, score: 80 }))} />);
    expect(screen.getByTestId('xo-complete')).toBeTruthy();
  });

  it('in setup, the memories suit offers training instead of asking what it would drop', () => {
    const onStartTraining = vi.fn();
    render(<TablePlay {...props(session({ focus: 'memories' }), { onStartTraining })} />);
    fireEvent.click(screen.getByTestId('xo-training-invite-start'));
    expect(onStartTraining).toHaveBeenCalled();
  });

  it('in training, the deck replaces the suits and a topic hands its prompt over', () => {
    const onPickTopic = vi.fn();
    render(<TablePlay {...props(session({ stage: 'training' }), { onPickTopic })} />);
    expect(screen.queryByTestId('xo-suits')).toBeNull();
    fireEvent.click(screen.getByTestId('xo-topic-communication'));
    expect(onPickTopic).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'communication' }),
      expect.stringContaining('reply exactly as I would'),
    );
  });
});
