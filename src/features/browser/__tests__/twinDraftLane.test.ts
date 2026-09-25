/**
 * The Twin draft lane — the flow the Browser toolbar drives, proven without a
 * page: arm → pick → draft → fill → record → inserted, and the three ways it
 * ends otherwise (a refusal, a cancelled pick, a navigation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PickedTarget } from '@/lib/bindings/PickedTarget';

import type { BrowserTab } from '../types';

vi.mock('@/api/browser', () => ({
  pickTarget: vi.fn(),
  pickCancel: vi.fn(),
  fillTarget: vi.fn(),
  submitTarget: vi.fn(),
  isPickCancelled: (err: unknown) =>
    typeof err === 'object' &&
    err !== null &&
    (err as { kind?: string }).kind === 'validation' &&
    String((err as { error?: string }).error).includes('pick_cancelled'),
  listenTabs: vi.fn(),
  listTabs: vi.fn(),
}));

vi.mock('@/api/twin/twin', () => ({
  draftForPage: vi.fn(),
  recordInteraction: vi.fn(),
}));

vi.mock('@/lib/errors/errorRegistry', () => ({
  resolveError: (raw: string) => ({ message: `friendly:${raw}`, category: 'unknown' }),
}));

vi.mock('@/lib/silentCatch', () => ({
  silentCatch: () => () => undefined,
}));

import * as browserApi from '@/api/browser';
import * as twinApi from '@/api/twin/twin';

import {
  arm,
  cancel,
  confirmSubmit,
  contactHandleOf,
  dismissSubmit,
  followTabs,
  noteTabs,
  pageContextOf,
  regenerate,
  requestSubmit,
  resetTwinDraftLane,
  setDirections,
  setSteer,
  toArmed,
  toIdle,
  twinDraftSnapshot,
  type TwinDraftSnapshot,
} from '../twinDraftLane';

const pickTarget = vi.mocked(browserApi.pickTarget);
const pickCancel = vi.mocked(browserApi.pickCancel);
const fillTarget = vi.mocked(browserApi.fillTarget);
const submitTarget = vi.mocked(browserApi.submitTarget);
const draftForPage = vi.mocked(twinApi.draftForPage);
const recordInteraction = vi.mocked(twinApi.recordInteraction);

function target(patch: Partial<PickedTarget> = {}): PickedTarget {
  return {
    ref: 'ref_3_ab12',
    label: 'Add a comment',
    existingText: '',
    formHint: 'Post',
    precedingText: 'Great write-up.',
    mainText: 'An article.',
    selectionText: '',
    thread: [],
    title: 'A post',
    url: 'https://forum.example.com/t/42',
    truncated: [],
    ...patch,
  };
}

function tab(id: number, url: string): BrowserTab {
  return {
    id,
    url,
    title: 'Tab',
    origin: new URL(url).origin,
    focused: false,
    lease: null,
    can_go_back: false,
    can_go_forward: false,
  };
}

const EMPTY: TwinDraftSnapshot = {
  phase: 'idle',
  tabId: null,
  tabUrl: null,
  target: null,
  lastDraft: null,
  error: null,
  steer: null,
  directions: '',
  confirmingSubmit: false,
};

/** Drive the lane to `inserted` with the default mocks. */
async function insertHappyPath(): Promise<void> {
  pickTarget.mockResolvedValueOnce(target());
  draftForPage.mockResolvedValueOnce({ draft: 'Thanks — agreed.', tone_channel: 'browser', kb_grounded: false });
  fillTarget.mockResolvedValueOnce(undefined);
  recordInteraction.mockResolvedValueOnce({} as never);
  await arm(7, 'twin-1');
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTwinDraftLane();
});

afterEach(() => {
  resetTwinDraftLane();
});

describe('pure transitions', () => {
  it('arming clears page-bound state but keeps the standing steer', () => {
    const prev: TwinDraftSnapshot = {
      ...EMPTY,
      phase: 'failed',
      error: 'x',
      target: target(),
      lastDraft: 'old',
      steer: 'warmer',
      directions: 'be brief',
    };
    const next = toArmed(prev, 3, 'https://a.example/');
    expect(next).toMatchObject({
      phase: 'armed',
      tabId: 3,
      tabUrl: 'https://a.example/',
      target: null,
      lastDraft: null,
      error: null,
      steer: 'warmer',
      directions: 'be brief',
    });
  });

  it('idle keeps steer + directions, forgets everything else', () => {
    const next = toIdle({ ...EMPTY, phase: 'inserted', target: target(), steer: 'formal', directions: 'd', tabId: 1 });
    expect(next).toEqual({ ...EMPTY, steer: 'formal', directions: 'd' });
  });

  it('followTabs resets on a url change or a vanished tab, and is identity otherwise', () => {
    const bound: TwinDraftSnapshot = { ...EMPTY, phase: 'inserted', tabId: 1, tabUrl: 'https://a.example/x', target: target() };
    expect(followTabs(bound, [tab(1, 'https://a.example/x')])).toBe(bound);
    expect(followTabs(bound, [tab(1, 'https://a.example/y')]).phase).toBe('idle');
    expect(followTabs(bound, [tab(2, 'https://a.example/x')]).phase).toBe('idle');
    expect(followTabs(EMPTY, [])).toBe(EMPTY);
  });

  it('followTabs binds the url on first sight when the lane armed before the store saw the tab', () => {
    const cold: TwinDraftSnapshot = { ...EMPTY, phase: 'armed', tabId: 1, tabUrl: null };
    const bound = followTabs(cold, [tab(1, 'https://a.example/x')]);
    expect(bound).toMatchObject({ phase: 'armed', tabUrl: 'https://a.example/x' });
    expect(followTabs(bound, [tab(1, 'https://a.example/y')]).phase).toBe('idle');
  });

  it('the page context is the target minus its ref', () => {
    const page = pageContextOf(target());
    expect(page).not.toHaveProperty('ref');
    expect(page.label).toBe('Add a comment');
  });

  it('files the insert under the page host', () => {
    expect(contactHandleOf('https://forum.example.com/t/42')).toBe('forum.example.com');
    expect(contactHandleOf('not a url')).toBe('not a url');
  });
});

describe('arm', () => {
  it('arm → drafting → inserted: drafts against the picked box, fills it, records the insert', async () => {
    setDirections('keep it short');
    setSteer('shorter');
    await insertHappyPath();

    const lane = twinDraftSnapshot();
    expect(lane.phase).toBe('inserted');
    expect(lane.tabId).toBe(7);
    expect(lane.target?.ref).toBe('ref_3_ab12');
    expect(lane.lastDraft).toBe('Thanks — agreed.');
    expect(lane.error).toBeNull();

    expect(pickTarget).toHaveBeenCalledWith(7);
    expect(draftForPage).toHaveBeenCalledWith('twin-1', pageContextOf(target()), 'keep it short', 'shorter');
    expect(fillTarget).toHaveBeenCalledWith(7, 'ref_3_ab12', 'Thanks — agreed.');
    expect(recordInteraction).toHaveBeenCalledWith(
      'twin-1',
      'browser',
      'out',
      'Thanks — agreed.',
      'forum.example.com',
      undefined,
      '{"kind":"placement"}',
      false,
    );
  });

  it('passes no directions / steer when the user set none', async () => {
    await insertHappyPath();
    expect(draftForPage).toHaveBeenCalledWith('twin-1', expect.anything(), undefined, undefined);
  });

  it('is armed while the pick is pending, and a second arm is a no-op', async () => {
    let resolvePick: (t: PickedTarget) => void = () => undefined;
    pickTarget.mockImplementationOnce(() => new Promise((resolve) => { resolvePick = resolve; }));
    const first = arm(7, 'twin-1');
    expect(twinDraftSnapshot().phase).toBe('armed');
    await arm(7, 'twin-1');
    expect(pickTarget).toHaveBeenCalledTimes(1);

    draftForPage.mockResolvedValueOnce({ draft: 'ok', tone_channel: 'browser', kb_grounded: false });
    fillTarget.mockResolvedValueOnce(undefined);
    recordInteraction.mockResolvedValueOnce({} as never);
    resolvePick(target());
    await first;
    expect(twinDraftSnapshot().phase).toBe('inserted');
  });

  it('a refused draft lands in failed with the registry message', async () => {
    pickTarget.mockResolvedValueOnce(target());
    draftForPage.mockRejectedValueOnce({ error: 'budget_exhausted', kind: 'forbidden' });
    await arm(7, 'twin-1');
    const lane = twinDraftSnapshot();
    expect(lane.phase).toBe('failed');
    expect(lane.error).toBe('friendly:budget_exhausted');
    expect(lane.target).not.toBeNull();
    expect(fillTarget).not.toHaveBeenCalled();
  });

  it('a failed fill is a failure too — the draft never reached the box', async () => {
    pickTarget.mockResolvedValueOnce(target());
    draftForPage.mockResolvedValueOnce({ draft: 'x', tone_channel: 'browser', kb_grounded: false });
    fillTarget.mockRejectedValueOnce(new Error('stale_page'));
    await arm(7, 'twin-1');
    expect(twinDraftSnapshot()).toMatchObject({ phase: 'failed', error: 'friendly:stale_page' });
    expect(recordInteraction).not.toHaveBeenCalled();
  });

  it('a cancelled pick goes back to idle silently', async () => {
    pickTarget.mockRejectedValueOnce({ error: 'pick_cancelled', kind: 'validation' });
    await arm(7, 'twin-1');
    expect(twinDraftSnapshot()).toEqual(EMPTY);
    expect(draftForPage).not.toHaveBeenCalled();
  });

  it('any other pick rejection is a failure', async () => {
    pickTarget.mockRejectedValueOnce({ error: 'unsupported_platform', kind: 'validation' });
    await arm(7, 'twin-1');
    expect(twinDraftSnapshot()).toMatchObject({ phase: 'failed', error: 'friendly:unsupported_platform' });
  });

  it('a failed ledger write does not undo an insert the user can see', async () => {
    pickTarget.mockResolvedValueOnce(target());
    draftForPage.mockResolvedValueOnce({ draft: 'x', tone_channel: 'browser', kb_grounded: false });
    fillTarget.mockResolvedValueOnce(undefined);
    recordInteraction.mockRejectedValueOnce(new Error('db'));
    await arm(7, 'twin-1');
    expect(twinDraftSnapshot().phase).toBe('inserted');
  });
});

describe('cancel', () => {
  it('disarms the page and returns to idle', async () => {
    pickTarget.mockImplementationOnce(() => new Promise(() => undefined));
    pickCancel.mockResolvedValueOnce(undefined);
    void arm(7, 'twin-1');
    expect(twinDraftSnapshot().phase).toBe('armed');
    await cancel(7);
    expect(pickCancel).toHaveBeenCalledWith(7);
    expect(twinDraftSnapshot().phase).toBe('idle');
  });

  it('a pick that resolves AFTER a cancel is ignored', async () => {
    let resolvePick: (t: PickedTarget) => void = () => undefined;
    pickTarget.mockImplementationOnce(() => new Promise((resolve) => { resolvePick = resolve; }));
    pickCancel.mockResolvedValueOnce(undefined);
    const run = arm(7, 'twin-1');
    await cancel(7);
    resolvePick(target());
    await run;
    expect(twinDraftSnapshot().phase).toBe('idle');
    expect(draftForPage).not.toHaveBeenCalled();
  });
});

describe('navigation', () => {
  it('a url change on the remembered tab resets the lane — the refs are dead', async () => {
    await insertHappyPath();
    noteTabs([tab(7, 'https://forum.example.com/t/42')]);
    expect(twinDraftSnapshot().phase).toBe('inserted');
    noteTabs([tab(7, 'https://forum.example.com/t/43')]);
    expect(twinDraftSnapshot()).toMatchObject({ phase: 'idle', target: null, tabId: null });
  });

  it('the remembered tab closing resets the lane', async () => {
    await insertHappyPath();
    noteTabs([tab(8, 'https://elsewhere.example/')]);
    expect(twinDraftSnapshot().phase).toBe('idle');
  });

  it('a navigation while ARMED resets too, and the late pick is ignored', async () => {
    let resolvePick: (t: PickedTarget) => void = () => undefined;
    pickTarget.mockImplementationOnce(() => new Promise((resolve) => { resolvePick = resolve; }));
    const run = arm(7, 'twin-1');
    noteTabs([tab(7, 'https://forum.example.com/t/42')]);
    expect(twinDraftSnapshot().phase).toBe('armed');
    noteTabs([tab(7, 'https://moved.example/')]);
    expect(twinDraftSnapshot().phase).toBe('idle');
    resolvePick(target());
    await run;
    expect(twinDraftSnapshot().phase).toBe('idle');
    expect(draftForPage).not.toHaveBeenCalled();
  });
});

describe('regenerate', () => {
  it('requires a remembered target', async () => {
    await regenerate('twin-1', 'warmer');
    expect(draftForPage).not.toHaveBeenCalled();
    expect(twinDraftSnapshot().phase).toBe('idle');
  });

  it('re-drafts into the same box with the new steer and directions', async () => {
    await insertHappyPath();
    draftForPage.mockResolvedValueOnce({ draft: 'Warmer take.', tone_channel: 'browser', kb_grounded: false });
    fillTarget.mockResolvedValueOnce(undefined);
    recordInteraction.mockResolvedValueOnce({} as never);

    await regenerate('twin-1', 'warmer', 'mention the deadline');

    expect(pickTarget).toHaveBeenCalledTimes(1);
    expect(draftForPage).toHaveBeenLastCalledWith('twin-1', pageContextOf(target()), 'mention the deadline', 'warmer');
    expect(fillTarget).toHaveBeenLastCalledWith(7, 'ref_3_ab12', 'Warmer take.');
    expect(twinDraftSnapshot()).toMatchObject({ phase: 'inserted', lastDraft: 'Warmer take.', steer: 'warmer' });
  });

  it('works from failed as long as the box was picked', async () => {
    pickTarget.mockResolvedValueOnce(target());
    draftForPage.mockRejectedValueOnce(new Error('boom'));
    await arm(7, 'twin-1');
    expect(twinDraftSnapshot().phase).toBe('failed');

    draftForPage.mockResolvedValueOnce({ draft: 'second try', tone_channel: 'browser', kb_grounded: false });
    fillTarget.mockResolvedValueOnce(undefined);
    recordInteraction.mockResolvedValueOnce({} as never);
    await regenerate('twin-1');
    expect(twinDraftSnapshot()).toMatchObject({ phase: 'inserted', error: null });
  });
});

describe('submit', () => {
  it('asks first, and only once a draft is in the box', async () => {
    requestSubmit();
    expect(twinDraftSnapshot().confirmingSubmit).toBe(false);
    await insertHappyPath();
    requestSubmit();
    expect(twinDraftSnapshot().confirmingSubmit).toBe(true);
    dismissSubmit();
    expect(twinDraftSnapshot().confirmingSubmit).toBe(false);
  });

  it('confirm presses the form control and lets the box go', async () => {
    await insertHappyPath();
    requestSubmit();
    submitTarget.mockResolvedValueOnce(undefined);
    await confirmSubmit(7);
    expect(submitTarget).toHaveBeenCalledWith(7, 'ref_3_ab12');
    expect(twinDraftSnapshot()).toMatchObject({ phase: 'idle', target: null, confirmingSubmit: false });
  });

  it('a refused submit is shown, and the box stays remembered for a retry', async () => {
    await insertHappyPath();
    requestSubmit();
    submitTarget.mockRejectedValueOnce({ error: 'pending_approval', kind: 'forbidden' });
    await confirmSubmit(7);
    expect(twinDraftSnapshot()).toMatchObject({
      phase: 'failed',
      error: 'friendly:pending_approval',
      confirmingSubmit: false,
    });
    expect(twinDraftSnapshot().target).not.toBeNull();
  });
});
