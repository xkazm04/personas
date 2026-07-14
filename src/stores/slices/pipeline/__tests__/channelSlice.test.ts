import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTeamChannel = vi.fn();
const postTeamDirective = vi.fn();
const countTeamChannelKinds = vi.fn();

vi.mock('@/api/pipeline/teamChannel', () => ({
  listTeamChannel: (...args: unknown[]) => listTeamChannel(...args),
  postTeamDirective: (...args: unknown[]) => postTeamDirective(...args),
  countTeamChannelKinds: (...args: unknown[]) => countTeamChannelKinds(...args),
}));

import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, countUnread, mergeHorizon, EMPTY_CHANNEL, CHANNEL_PAGE, type ChannelTeamState } from '../channelSlice';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/** Minimal channel item — only the fields the slice actually reads. */
function item(id: string, at: string, kind = 'persona'): TeamChannelItem {
  return {
    id,
    kind,
    at,
    personaId: null,
    label: kind,
    body: null,
    assignmentId: null,
    stepId: null,
    extra: null,
    replyTo: null,
    deliberationId: null,
    importance: null,
    consumers: null,
  };
}

/** A full page — anything shorter tells the slice it hit the start of history. */
function page(prefix: string, at: string, n = CHANNEL_PAGE): TeamChannelItem[] {
  return Array.from({ length: n }, (_, i) => item(`${prefix}${i}`, at));
}

function state(items: TeamChannelItem[], exhausted = false): ChannelTeamState {
  return { ...EMPTY_CHANNEL, items, loaded: true, exhausted };
}

function resetStore() {
  usePipelineStore.setState({ channels: {}, channelSubs: {}, channelCounts: {} });
  listTeamChannel.mockReset();
  postTeamDirective.mockReset();
  countTeamChannelKinds.mockReset();
  countTeamChannelKinds.mockResolvedValue({ step: 0, event: 0, memory: 0, message: 0, deliberation: 0 });
  localStorage.clear();
}

describe('channelSlice — refcounted subscription', () => {
  beforeEach(resetStore);

  it('fetches once for the first subscriber and not again for the second', async () => {
    listTeamChannel.mockResolvedValue([item('a', '2026-07-13T10:00:00Z')]);
    const { subscribeChannel } = usePipelineStore.getState();

    const releaseA = subscribeChannel('team-1');
    const releaseB = subscribeChannel('team-1');
    await vi.waitFor(() => expect(usePipelineStore.getState().channels[channelKey('team-1')]?.loaded).toBe(true));

    // The whole point of P0: two surfaces on one team = one fetch.
    expect(listTeamChannel).toHaveBeenCalledTimes(1);
    expect(usePipelineStore.getState().channelSubs[channelKey('team-1')]).toBe(2);

    releaseA();
    expect(usePipelineStore.getState().channelSubs[channelKey('team-1')]).toBe(1);
    releaseB();
    expect(usePipelineStore.getState().channelSubs[channelKey('team-1')]).toBeUndefined();
  });

  it('keeps the cache warm after the last release', async () => {
    listTeamChannel.mockResolvedValue([item('a', '2026-07-13T10:00:00Z')]);
    const { subscribeChannel } = usePipelineStore.getState();

    subscribeChannel('team-1')();
    await vi.waitFor(() => expect(usePipelineStore.getState().channels[channelKey('team-1')]?.items).toHaveLength(1));

    expect(usePipelineStore.getState().channelSubs[channelKey('team-1')]).toBeUndefined();
    expect(usePipelineStore.getState().channels[channelKey('team-1')]?.items).toHaveLength(1);
  });

  it('release is idempotent — StrictMode double-cleanup cannot underflow the refcount', async () => {
    listTeamChannel.mockResolvedValue([]);
    const { subscribeChannel } = usePipelineStore.getState();

    const release = subscribeChannel('team-1');
    subscribeChannel('team-1');

    release();
    release(); // second call must be a no-op, not another decrement
    expect(usePipelineStore.getState().channelSubs[channelKey('team-1')]).toBe(1);
  });

  it('refreshSubscribedChannels refreshes every subscribed team and nothing else', async () => {
    listTeamChannel.mockResolvedValue([]);
    const { subscribeChannel, refreshSubscribedChannels } = usePipelineStore.getState();

    subscribeChannel('team-1');
    subscribeChannel('team-2');
    await vi.waitFor(() => expect(listTeamChannel).toHaveBeenCalledTimes(2));
    listTeamChannel.mockClear();

    await refreshSubscribedChannels();
    expect(listTeamChannel).toHaveBeenCalledTimes(2);
    expect(listTeamChannel.mock.calls.map((c) => c[0]).sort()).toEqual(['team-1', 'team-2']);
  });
});

describe('channelSlice — head merge and paging', () => {
  beforeEach(resetStore);

  it('merges a fresh head over the loaded window, keeping older pages', async () => {
    const { refreshChannel, loadOlderChannel } = usePipelineStore.getState();
    const key = channelKey('team-1');

    // A FULL head page — the channel has more history behind it.
    listTeamChannel.mockResolvedValueOnce(page('b', '2026-07-13T10:00:00Z'));
    await refreshChannel(key);
    expect(usePipelineStore.getState().channels[key]?.exhausted).toBe(false);

    // Page older history (a short page = the start of history).
    listTeamChannel.mockResolvedValueOnce([item('a', '2026-07-13T09:00:00Z')]);
    await loadOlderChannel(key);
    let items = usePipelineStore.getState().channels[key]!.items;
    expect(items).toHaveLength(CHANNEL_PAGE + 1);
    expect(items[items.length - 1]!.id).toBe('a');
    expect(usePipelineStore.getState().channels[key]?.exhausted).toBe(true);

    // A new head arrives; the older page must survive, with no duplicates.
    listTeamChannel.mockResolvedValueOnce([
      item('c', '2026-07-13T11:00:00Z'),
      ...page('b', '2026-07-13T10:00:00Z'),
    ]);
    await refreshChannel(key);
    items = usePipelineStore.getState().channels[key]!.items;
    expect(items[0]!.id).toBe('c');
    expect(items[items.length - 1]!.id).toBe('a');
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length);
  });

  it('a short FIRST page means the channel is already exhausted', async () => {
    // Load-bearing: a 3-row team that never became `exhausted` would pin the
    // merge horizon at its own oldest row forever, hiding every other team's
    // history below that point.
    listTeamChannel.mockResolvedValue([item('only', '2026-07-13T10:00:00Z')]);
    const key = channelKey('team-1');
    await usePipelineStore.getState().refreshChannel(key);

    expect(usePipelineStore.getState().channels[key]?.exhausted).toBe(true);

    listTeamChannel.mockClear();
    await usePipelineStore.getState().loadOlderChannel(key);
    expect(listTeamChannel).not.toHaveBeenCalled();
  });

  it('pages with a COMPOSITE (at, id) cursor, not the timestamp alone', async () => {
    const key = channelKey('team-1');
    listTeamChannel.mockResolvedValueOnce(page('x', '2026-07-13T10:00:00Z'));
    await usePipelineStore.getState().refreshChannel(key);

    listTeamChannel.mockResolvedValueOnce([]);
    await usePipelineStore.getState().loadOlderChannel(key);

    const [, , cursor] = listTeamChannel.mock.calls[1]!;
    expect(cursor).toEqual({ at: '2026-07-13T10:00:00Z', id: `x${CHANNEL_PAGE - 1}` });
  });
});

describe('channelSlice — the merge horizon (k-way paging)', () => {
  beforeEach(resetStore);

  it('is the NEWEST of the per-team oldest rows — the deepest complete point', () => {
    // A is loaded back to 08:00, B only to 10:00. Below 10:00 the merge is
    // incomplete (B has unfetched rows down there), so 10:00 is the horizon.
    const a = state([item('a1', '2026-07-13T12:00:00Z'), item('a2', '2026-07-13T08:00:00Z')]);
    const b = state([item('b1', '2026-07-13T11:00:00Z'), item('b2', '2026-07-13T10:00:00Z')]);
    expect(mergeHorizon([a, b])).toBe('2026-07-13T10:00:00Z');
  });

  it('ignores exhausted teams — they have no history left to surprise us with', () => {
    const a = state([item('a1', '2026-07-13T12:00:00Z'), item('a2', '2026-07-13T08:00:00Z')]);
    const shallowButDone = state([item('b1', '2026-07-13T11:00:00Z')], true);
    expect(mergeHorizon([a, shallowButDone])).toBe('2026-07-13T08:00:00Z');
  });

  it('lifts entirely once every team is exhausted', () => {
    const a = state([item('a1', '2026-07-13T12:00:00Z')], true);
    const b = state([item('b1', '2026-07-13T09:00:00Z')], true);
    expect(mergeHorizon([a, b])).toBeNull();
  });

  it('loadOlderMerged deepens the SHALLOWEST team — the one holding the horizon up', async () => {
    const deep = channelKey('team-1');
    const shallow = channelKey('team-2');
    usePipelineStore.setState({
      channels: {
        [deep]: state([item('a1', '2026-07-13T12:00:00Z'), item('a2', '2026-07-13T08:00:00Z')]),
        [shallow]: state([item('b1', '2026-07-13T11:00:00Z'), item('b2', '2026-07-13T10:00:00Z')]),
      },
    });

    listTeamChannel.mockResolvedValue([]);
    await usePipelineStore.getState().loadOlderMerged(['team-1', 'team-2']);

    expect(listTeamChannel).toHaveBeenCalledTimes(1);
    expect(listTeamChannel.mock.calls[0]![0]).toBe('team-2');
  });

  it('loadOlderMerged does nothing when every team is exhausted', async () => {
    usePipelineStore.setState({
      channels: {
        [channelKey('team-1')]: state([item('a', '2026-07-13T12:00:00Z')], true),
      },
    });
    await usePipelineStore.getState().loadOlderMerged(['team-1']);
    expect(listTeamChannel).not.toHaveBeenCalled();
  });
});

describe('channelSlice — (team, kinds) cache keys', () => {
  beforeEach(resetStore);

  it('a lens fetch and a blended fetch are DIFFERENT cache entries', async () => {
    // They are different pages of different SQL queries — sharing an entry would
    // reintroduce the starvation P1 fixed (a memory lens over a blended page).
    listTeamChannel.mockResolvedValue([]);
    const { subscribeChannel } = usePipelineStore.getState();

    subscribeChannel('team-1');
    subscribeChannel('team-1', ['memory']);
    await vi.waitFor(() => expect(listTeamChannel).toHaveBeenCalledTimes(2));

    const subs = usePipelineStore.getState().channelSubs;
    expect(subs[channelKey('team-1')]).toBe(1);
    expect(subs[channelKey('team-1', ['memory'])]).toBe(1);
    // …and the kinds actually reached the wire.
    expect(listTeamChannel.mock.calls.map((c) => c[3])).toEqual(
      expect.arrayContaining([undefined, ['memory']]),
    );
  });

  it('kinds are order-insensitive — one entry, not two', () => {
    expect(channelKey('t', ['memory', 'step'])).toBe(channelKey('t', ['step', 'memory']));
  });
});

describe('channelSlice — unread (D6)', () => {
  beforeEach(resetStore);

  it('counts everything as unread on a never-seen channel, excluding the user\'s own posts', () => {
    const state = {
      ...EMPTY_CHANNEL,
      items: [
        item('c', '2026-07-13T12:00:00Z'),
        item('b', '2026-07-13T11:00:00Z', 'directive'), // the user's own
        item('a', '2026-07-13T10:00:00Z'),
      ],
    };
    expect(countUnread(state)).toBe(2);
  });

  it('counts only items newer than the watermark', () => {
    const state = {
      ...EMPTY_CHANNEL,
      lastSeenAt: '2026-07-13T11:00:00Z',
      items: [
        item('c', '2026-07-13T12:00:00Z'),
        item('b', '2026-07-13T11:00:00Z'), // exactly at the mark → read
        item('a', '2026-07-13T10:00:00Z'),
      ],
    };
    expect(countUnread(state)).toBe(1);
  });

  it('markChannelSeen advances the watermark to the newest row and persists it', async () => {
    listTeamChannel.mockResolvedValue([
      item('c', '2026-07-13T12:00:00Z'),
      item('a', '2026-07-13T10:00:00Z'),
    ]);
    const { refreshChannel, markChannelSeen } = usePipelineStore.getState();
    await refreshChannel(channelKey('team-1'));

    expect(countUnread(usePipelineStore.getState().channels[channelKey('team-1')]!)).toBe(2);

    markChannelSeen('team-1');
    expect(usePipelineStore.getState().channels[channelKey('team-1')]?.lastSeenAt).toBe('2026-07-13T12:00:00Z');
    expect(localStorage.getItem('personas.channel.lastSeen.team-1')).toBe('2026-07-13T12:00:00Z');
    expect(countUnread(usePipelineStore.getState().channels[channelKey('team-1')]!)).toBe(0);
  });

  it('hydrates the persisted watermark on first subscribe', async () => {
    localStorage.setItem('personas.channel.lastSeen.team-1', '2026-07-13T11:00:00Z');
    listTeamChannel.mockResolvedValue([
      item('c', '2026-07-13T12:00:00Z'),
      item('a', '2026-07-13T10:00:00Z'),
    ]);

    usePipelineStore.getState().subscribeChannel('team-1');
    await vi.waitFor(() => expect(usePipelineStore.getState().channels[channelKey('team-1')]?.loaded).toBe(true));

    expect(usePipelineStore.getState().channels[channelKey('team-1')]?.lastSeenAt).toBe('2026-07-13T11:00:00Z');
    expect(countUnread(usePipelineStore.getState().channels[channelKey('team-1')]!)).toBe(1);
  });
});

describe('channelSlice — directives', () => {
  beforeEach(resetStore);

  it('posts, refreshes the head, and clears posting', async () => {
    listTeamChannel.mockResolvedValue([item('a', '2026-07-13T10:00:00Z', 'directive')]);
    postTeamDirective.mockResolvedValue(undefined);

    await usePipelineStore.getState().sendChannelDirective('team-1', '  ship it  ', 'reply-1');

    expect(postTeamDirective).toHaveBeenCalledWith('team-1', 'ship it', 'reply-1');
    expect(listTeamChannel).toHaveBeenCalledTimes(1);
    expect(usePipelineStore.getState().channels[channelKey('team-1')]?.posting).toBe(false);
  });

  it('ignores an empty directive', async () => {
    await usePipelineStore.getState().sendChannelDirective('team-1', '   ');
    expect(postTeamDirective).not.toHaveBeenCalled();
  });

  it('clears posting even when the post throws', async () => {
    listTeamChannel.mockResolvedValue([]);
    usePipelineStore.getState().subscribeChannel('team-1');
    await vi.waitFor(() => expect(usePipelineStore.getState().channels[channelKey('team-1')]).toBeDefined());

    postTeamDirective.mockRejectedValue(new Error('offline'));
    await expect(usePipelineStore.getState().sendChannelDirective('team-1', 'x')).rejects.toThrow('offline');
    expect(usePipelineStore.getState().channels[channelKey('team-1')]?.posting).toBe(false);
  });
});
