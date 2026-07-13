import { beforeEach, describe, expect, it, vi } from 'vitest';

const listTeamChannel = vi.fn();
const postTeamDirective = vi.fn();

vi.mock('@/api/pipeline/teamChannel', () => ({
  listTeamChannel: (...args: unknown[]) => listTeamChannel(...args),
  postTeamDirective: (...args: unknown[]) => postTeamDirective(...args),
}));

import { usePipelineStore } from '@/stores/pipelineStore';
import { countUnread, EMPTY_CHANNEL } from '../channelSlice';
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
  };
}

function resetStore() {
  usePipelineStore.setState({ channels: {}, channelSubs: {} });
  listTeamChannel.mockReset();
  postTeamDirective.mockReset();
  localStorage.clear();
}

describe('channelSlice — refcounted subscription', () => {
  beforeEach(resetStore);

  it('fetches once for the first subscriber and not again for the second', async () => {
    listTeamChannel.mockResolvedValue([item('a', '2026-07-13T10:00:00Z')]);
    const { subscribeChannel } = usePipelineStore.getState();

    const releaseA = subscribeChannel('team-1');
    const releaseB = subscribeChannel('team-1');
    await vi.waitFor(() => expect(usePipelineStore.getState().channels['team-1']?.loaded).toBe(true));

    // The whole point of P0: two surfaces on one team = one fetch.
    expect(listTeamChannel).toHaveBeenCalledTimes(1);
    expect(usePipelineStore.getState().channelSubs['team-1']).toBe(2);

    releaseA();
    expect(usePipelineStore.getState().channelSubs['team-1']).toBe(1);
    releaseB();
    expect(usePipelineStore.getState().channelSubs['team-1']).toBeUndefined();
  });

  it('keeps the cache warm after the last release', async () => {
    listTeamChannel.mockResolvedValue([item('a', '2026-07-13T10:00:00Z')]);
    const { subscribeChannel } = usePipelineStore.getState();

    subscribeChannel('team-1')();
    await vi.waitFor(() => expect(usePipelineStore.getState().channels['team-1']?.items).toHaveLength(1));

    expect(usePipelineStore.getState().channelSubs['team-1']).toBeUndefined();
    expect(usePipelineStore.getState().channels['team-1']?.items).toHaveLength(1);
  });

  it('release is idempotent — StrictMode double-cleanup cannot underflow the refcount', async () => {
    listTeamChannel.mockResolvedValue([]);
    const { subscribeChannel } = usePipelineStore.getState();

    const release = subscribeChannel('team-1');
    subscribeChannel('team-1');

    release();
    release(); // second call must be a no-op, not another decrement
    expect(usePipelineStore.getState().channelSubs['team-1']).toBe(1);
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

    listTeamChannel.mockResolvedValueOnce([item('b', '2026-07-13T10:00:00Z')]);
    await refreshChannel('team-1');

    // Page older history.
    listTeamChannel.mockResolvedValueOnce([item('a', '2026-07-13T09:00:00Z')]);
    await loadOlderChannel('team-1');
    expect(usePipelineStore.getState().channels['team-1']?.items.map((i) => i.id)).toEqual(['b', 'a']);

    // A new head arrives; the older page must survive, no duplicates.
    listTeamChannel.mockResolvedValueOnce([
      item('c', '2026-07-13T11:00:00Z'),
      item('b', '2026-07-13T10:00:00Z'),
    ]);
    await refreshChannel('team-1');
    expect(usePipelineStore.getState().channels['team-1']?.items.map((i) => i.id)).toEqual(['c', 'b', 'a']);
  });

  it('marks exhausted when a keyset page comes back empty, and stops paging', async () => {
    const { refreshChannel, loadOlderChannel } = usePipelineStore.getState();

    listTeamChannel.mockResolvedValueOnce([item('b', '2026-07-13T10:00:00Z')]);
    await refreshChannel('team-1');

    listTeamChannel.mockResolvedValueOnce([]);
    await loadOlderChannel('team-1');
    expect(usePipelineStore.getState().channels['team-1']?.exhausted).toBe(true);

    listTeamChannel.mockClear();
    await loadOlderChannel('team-1');
    expect(listTeamChannel).not.toHaveBeenCalled();
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
    await refreshChannel('team-1');

    expect(countUnread(usePipelineStore.getState().channels['team-1']!)).toBe(2);

    markChannelSeen('team-1');
    expect(usePipelineStore.getState().channels['team-1']?.lastSeenAt).toBe('2026-07-13T12:00:00Z');
    expect(localStorage.getItem('personas.channel.lastSeen.team-1')).toBe('2026-07-13T12:00:00Z');
    expect(countUnread(usePipelineStore.getState().channels['team-1']!)).toBe(0);
  });

  it('hydrates the persisted watermark on first subscribe', async () => {
    localStorage.setItem('personas.channel.lastSeen.team-1', '2026-07-13T11:00:00Z');
    listTeamChannel.mockResolvedValue([
      item('c', '2026-07-13T12:00:00Z'),
      item('a', '2026-07-13T10:00:00Z'),
    ]);

    usePipelineStore.getState().subscribeChannel('team-1');
    await vi.waitFor(() => expect(usePipelineStore.getState().channels['team-1']?.loaded).toBe(true));

    expect(usePipelineStore.getState().channels['team-1']?.lastSeenAt).toBe('2026-07-13T11:00:00Z');
    expect(countUnread(usePipelineStore.getState().channels['team-1']!)).toBe(1);
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
    expect(usePipelineStore.getState().channels['team-1']?.posting).toBe(false);
  });

  it('ignores an empty directive', async () => {
    await usePipelineStore.getState().sendChannelDirective('team-1', '   ');
    expect(postTeamDirective).not.toHaveBeenCalled();
  });

  it('clears posting even when the post throws', async () => {
    listTeamChannel.mockResolvedValue([]);
    usePipelineStore.getState().subscribeChannel('team-1');
    await vi.waitFor(() => expect(usePipelineStore.getState().channels['team-1']).toBeDefined());

    postTeamDirective.mockRejectedValue(new Error('offline'));
    await expect(usePipelineStore.getState().sendChannelDirective('team-1', 'x')).rejects.toThrow('offline');
    expect(usePipelineStore.getState().channels['team-1']?.posting).toBe(false);
  });
});
