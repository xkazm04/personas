/**
 * The three badge states the replies lane now renders, and the distinction the
 * card is really about: **never-used is not stale**. `useChannelActivity`
 * already encodes that by omitting never-bridged channels from
 * `staleByChannel` instead of defaulting them to true; the strip has to keep
 * the distinction visible rather than collapse it into one amber warning.
 *
 * Fixture is the card's: Slack bridged 40 days ago, Discord never, Email
 * yesterday.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { TwinCommunication } from '@/lib/bindings/TwinCommunication';
import type { TwinChannel } from '@/lib/bindings/TwinChannel';

const DAY = 24 * 60 * 60 * 1000;
const iso = (agoMs: number) => new Date(Date.now() - agoMs).toISOString();

function comm(over: Partial<TwinCommunication>): TwinCommunication {
  return {
    id: 'c',
    twin_id: 't1',
    channel: 'slack',
    direction: 'in',
    contact_handle: 'alice',
    content: 'hi',
    summary: null,
    key_facts_json: null,
    occurred_at: iso(0),
    created_at: iso(0),
    ...over,
  };
}

const mockState = {
  fetchTwinCommunications: vi.fn().mockResolvedValue(undefined),
  twinCommsLoading: false,
  twinCommunications: [
    comm({ id: 'a', channel: 'slack', occurred_at: iso(40 * DAY) }),
    comm({ id: 'b', channel: 'email', occurred_at: iso(1 * DAY) }),
  ] as TwinCommunication[],
};

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
}));

import { ChannelHealthStrip, healthOf } from '../ChannelHealthStrip';

function chan(type: string, over: Partial<TwinChannel> = {}): TwinChannel {
  return {
    id: `ch-${type}`,
    twin_id: 't1',
    channel_type: type,
    credential_id: 'cred',
    persona_id: null,
    label: null,
    is_active: true,
    created_at: iso(0),
    updated_at: iso(0),
    ...over,
  };
}

describe('ChannelHealthStrip', () => {
  it('renders three DISTINCT states — stale, never and quiet', () => {
    render(
      <ChannelHealthStrip
        twinId="t1"
        channels={[chan('slack'), chan('discord'), chan('email')]}
      />,
    );

    expect(screen.getByTestId('channel-health-slack').getAttribute('data-health')).toBe('stale');
    expect(screen.getByTestId('channel-health-discord').getAttribute('data-health')).toBe('never');
    expect(screen.getByTestId('channel-health-email').getAttribute('data-health')).toBe('quiet');
  });

  it('a stale channel is still listed — the badge warns, it does not hide', () => {
    render(<ChannelHealthStrip twinId="t1" channels={[chan('slack')]} />);
    expect(screen.getByTestId('channel-health-slack')).toBeTruthy();
  });

  it('renders nothing when no channel is active', () => {
    render(<ChannelHealthStrip twinId="t1" channels={[chan('slack', { is_active: false })]} />);
    expect(screen.queryByTestId('channel-health-strip')).toBeNull();
  });

  it('never-used is decided by absence from lastByChannel, not by a stale default', () => {
    const last = new Map([['slack', iso(40 * DAY)]]);
    // The hook OMITS never-bridged channels here rather than writing `false`.
    const stale = new Map([['slack', true]]);
    expect(healthOf('slack', last, stale)).toBe('stale');
    expect(healthOf('discord', last, stale)).toBe('never');
    expect(healthOf('discord', new Map([['discord', iso(0)]]), new Map([['discord', false]]))).toBe('quiet');
  });
});
