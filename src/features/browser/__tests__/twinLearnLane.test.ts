/**
 * The Twin learn lane — Browser > Learn, proven without a page: capture the
 * selection (or fall back to the clipboard), choose, then teach the active
 * twin (learning -> done on the sample's event) or hand the sample to the
 * forge (New twin).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { TwinSampleUpdatedEvent } from '@/lib/bindings/TwinSampleUpdatedEvent';

vi.mock('@/api/browser', () => ({
  captureSelection: vi.fn(),
  listenTabs: vi.fn(),
  listTabs: vi.fn(),
}));

vi.mock('@/api/twin/twinSample', () => ({
  clipboardText: vi.fn(),
  learnFromSample: vi.fn(),
  sampleList: vi.fn(),
}));

vi.mock('@/features/plugins/twin/experience/launcher', () => ({
  openTwinExperience: vi.fn(),
}));

vi.mock('@/lib/errors/errorRegistry', () => ({
  resolveError: (raw: string) => ({ message: `friendly:${raw}`, category: 'unknown' }),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
  extractMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

const listeners: Array<(payload: TwinSampleUpdatedEvent) => void> = [];
const unlisten = vi.fn();
vi.mock('@/lib/eventRegistry', () => ({
  EventName: { TWIN_SAMPLE_UPDATED: 'twin-sample-updated' },
  typedListen: vi.fn(async (_event: string, handler: (payload: TwinSampleUpdatedEvent) => void) => {
    listeners.push(handler);
    return unlisten;
  }),
}));

import * as browserApi from '@/api/browser';
import * as twinSample from '@/api/twin/twinSample';
import { openTwinExperience } from '@/features/plugins/twin/experience/launcher';
import { typedListen } from '@/lib/eventRegistry';

import {
  SAMPLE_CAP,
  capture,
  clipSample,
  countWords,
  dismissLearn,
  newTwin,
  noteSampleUpdated,
  resetTwinLearnLane,
  settleOnEvent,
  teach,
  twinLearnSnapshot,
  type TwinLearnSnapshot,
} from '../twinLearnLane';

const captureSelection = vi.mocked(browserApi.captureSelection);
const clipboardText = vi.mocked(twinSample.clipboardText);
const learnFromSample = vi.mocked(twinSample.learnFromSample);
const sampleList = vi.mocked(twinSample.sampleList);

function selection(text: string, host: string | null = 'mail.example.com') {
  return { text, title: 'Inbox', url: host ? `https://${host}/inbox` : null, host, truncated: false };
}

function sampleRow(id: string, status = 'analyzing', error: string | null = null) {
  return {
    id, twinId: 't1', text: 'x', channel: null, sourceKind: 'selection', sourceHost: 'mail.example.com',
    status, error, createdAt: '2026-10-01T10:00:00Z', analyzedAt: null,
  };
}

/** Flush the microtasks a settled mock leaves behind. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

async function captureFrom(text: string): Promise<void> {
  captureSelection.mockResolvedValueOnce(selection(text));
  await capture(7);
}

beforeEach(() => {
  resetTwinLearnLane();
  vi.clearAllMocks();
  listeners.length = 0;
});

afterEach(() => {
  resetTwinLearnLane();
});

describe('pure helpers', () => {
  it('trims and caps a sample, and counts its words', () => {
    expect(clipSample('   ')).toBe('');
    expect(clipSample(null)).toBe('');
    expect(clipSample('x'.repeat(SAMPLE_CAP + 50))).toHaveLength(SAMPLE_CAP);
    expect(countWords(' Hi there,\n friend ')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('settles only on its own sample, and only on a terminal status', () => {
    const learning: TwinLearnSnapshot = { ...twinLearnSnapshot(), phase: 'learning', sampleId: 's1', twinId: 't1' };
    const other = { twinId: 't1', sampleId: 's2', status: 'ready', proposals: 3 };
    expect(settleOnEvent(learning, other)).toBe(learning);
    expect(settleOnEvent(learning, { ...other, sampleId: 's1', status: 'analyzing' })).toBe(learning);
    expect(settleOnEvent(learning, { ...other, sampleId: 's1' })).toMatchObject({ phase: 'done', proposals: 3 });
    expect(settleOnEvent(learning, { ...other, sampleId: 's1', status: 'refused' })).toMatchObject({ phase: 'failed', failure: 'refused' });
    expect(settleOnEvent(learning, { ...other, sampleId: 's1', status: 'failed' })).toMatchObject({ phase: 'failed', failure: 'analysis' });
  });
});

describe('capture', () => {
  it('takes the selection when the page has one, with its host and word count', async () => {
    captureSelection.mockResolvedValueOnce(selection('  I would love to, see you Friday.  '));
    const pending = capture(7);
    expect(twinLearnSnapshot().phase).toBe('capturing');
    await pending;

    expect(captureSelection).toHaveBeenCalledWith(7);
    expect(clipboardText).not.toHaveBeenCalled();
    expect(twinLearnSnapshot()).toMatchObject({
      phase: 'choosing',
      source: 'selection',
      host: 'mail.example.com',
      text: 'I would love to, see you Friday.',
      words: 7,
      tabId: 7,
    });
  });

  it('falls back to the clipboard when the page rejects (CSP, no hand)', async () => {
    captureSelection.mockRejectedValueOnce(new Error('relay timed out'));
    clipboardText.mockResolvedValueOnce('Copied words here');
    await capture(7);

    expect(clipboardText).toHaveBeenCalledTimes(1);
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'choosing', source: 'clipboard', host: null, words: 3 });
  });

  it('falls back to the clipboard when nothing is selected', async () => {
    captureSelection.mockResolvedValueOnce(selection(''));
    clipboardText.mockResolvedValueOnce('From the clipboard');
    await capture(7);
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'choosing', source: 'clipboard' });
  });

  it('reads only the clipboard when no tab is open', async () => {
    clipboardText.mockResolvedValueOnce('Only clipboard');
    await capture(null);
    expect(captureSelection).not.toHaveBeenCalled();
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'choosing', source: 'clipboard' });
  });

  it('both empty is failed with nothing_selected', async () => {
    captureSelection.mockResolvedValueOnce(selection('   '));
    clipboardText.mockResolvedValueOnce(null);
    await capture(7);
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'failed', failure: 'nothing_selected' });
  });

  it('a page that could not be read with an empty clipboard says to copy and retry', async () => {
    captureSelection.mockRejectedValueOnce(new Error('csp'));
    clipboardText.mockResolvedValueOnce('');
    await capture(7);
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'failed', failure: 'capture' });
  });

  it('a second Learn supersedes the first, whose late answer is dropped', async () => {
    let resolveFirst: (v: ReturnType<typeof selection>) => void = () => undefined;
    captureSelection.mockReturnValueOnce(new Promise((r) => { resolveFirst = r; }));
    const first = capture(7);
    await captureFrom('second capture wins');
    resolveFirst(selection('first capture loses'));
    await first;
    expect(twinLearnSnapshot().text).toBe('second capture wins');
  });
});

describe('teach', () => {
  it('learning, then done with the proposal count on the sample event', async () => {
    await captureFrom('My own words, as I write them.');
    learnFromSample.mockResolvedValueOnce(sampleRow('s1'));

    const pending = teach('t1');
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'learning', twinId: 't1' });
    await pending;

    expect(learnFromSample).toHaveBeenCalledWith('t1', 'My own words, as I write them.', 'selection', 'mail.example.com');
    expect(typedListen).toHaveBeenCalledWith('twin-sample-updated', expect.any(Function));
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'learning', sampleId: 's1' });

    // Another twin's sample does not settle this lane.
    listeners[0]({ twinId: 't2', sampleId: 'other', status: 'ready', proposals: 9 });
    expect(twinLearnSnapshot().phase).toBe('learning');

    listeners[0]({ twinId: 't1', sampleId: 's1', status: 'ready', proposals: 4 });
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'done', proposals: 4 });
    await flush();
    // Leaving `learning` releases the subscription.
    expect(unlisten).toHaveBeenCalled();
  });

  it('an analysis that finishes before the invoke resolves is not lost', async () => {
    await captureFrom('quick sample');
    let resolveLearn: (v: ReturnType<typeof sampleRow>) => void = () => undefined;
    learnFromSample.mockReturnValueOnce(new Promise((r) => { resolveLearn = r; }));

    const pending = teach('t1');
    await flush();
    noteSampleUpdated({ twinId: 't1', sampleId: 's9', status: 'ready', proposals: 0 });
    expect(twinLearnSnapshot().phase).toBe('learning');
    resolveLearn(sampleRow('s9'));
    await pending;

    expect(twinLearnSnapshot()).toMatchObject({ phase: 'done', proposals: 0 });
  });

  it('a refusal fails with the sample\'s own reason', async () => {
    await captureFrom('a draft my twin placed');
    learnFromSample.mockResolvedValueOnce(sampleRow('s2'));
    sampleList.mockResolvedValueOnce([sampleRow('s2', 'refused', 'this is a draft your twin wrote')]);
    await teach('t1');

    noteSampleUpdated({ twinId: 't1', sampleId: 's2', status: 'refused', proposals: 0 });
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'failed', failure: 'refused', detail: null });
    await flush();
    expect(sampleList).toHaveBeenCalledWith('t1');
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'failed', failure: 'refused', detail: 'this is a draft your twin wrote' });
  });

  it('a rejected command (the backend not built yet) fails inline with the resolved message', async () => {
    await captureFrom('words');
    learnFromSample.mockRejectedValueOnce(new Error('not built yet'));
    await teach('t1');
    expect(twinLearnSnapshot()).toMatchObject({ phase: 'failed', failure: 'error', detail: 'friendly:not built yet' });
  });

  it('does nothing outside choosing', async () => {
    await teach('t1');
    expect(learnFromSample).not.toHaveBeenCalled();
    expect(twinLearnSnapshot().phase).toBe('idle');
  });
});

describe('new twin and dismiss', () => {
  it('hands the sample to the forge as a seed and lets go', async () => {
    await captureFrom('Seed for a brand new twin');
    newTwin();
    expect(openTwinExperience).toHaveBeenCalledWith({
      mode: 'create',
      seedSample: { text: 'Seed for a brand new twin', sourceKind: 'selection', sourceHost: 'mail.example.com' },
    });
    expect(twinLearnSnapshot().phase).toBe('idle');
  });

  it('a clipboard seed carries no host', async () => {
    captureSelection.mockRejectedValueOnce(new Error('csp'));
    clipboardText.mockResolvedValueOnce('clipboard seed');
    await capture(7);
    newTwin();
    expect(openTwinExperience).toHaveBeenCalledWith({
      mode: 'create',
      seedSample: { text: 'clipboard seed', sourceKind: 'clipboard', sourceHost: null },
    });
  });

  it('dismiss drops a learning run, and its late event changes nothing', async () => {
    await captureFrom('words to learn');
    learnFromSample.mockResolvedValueOnce(sampleRow('s3'));
    await teach('t1');
    dismissLearn();
    expect(twinLearnSnapshot().phase).toBe('idle');
    noteSampleUpdated({ twinId: 't1', sampleId: 's3', status: 'ready', proposals: 2 });
    expect(twinLearnSnapshot().phase).toBe('idle');
  });
});
