import { describe, expect, it } from 'vitest';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import type { Persona } from '@/lib/bindings/Persona';
import { itemKind } from '../lensModel';
import { buildConversation } from '../conversationModel';
import { authorName, slackAuthorName, itemAccent, AUTHOR_KIND_META } from '@/features/teams/sub_collab/collabRender';
import { buildTeamBridgeIndex, findTeamSlackBridge } from '@/lib/channel/teamBridge';

function item(over: Partial<TeamChannelItem> = {}): TeamChannelItem {
  return {
    id: 'i1',
    kind: 'slack',
    at: '2026-08-04T10:00:00Z',
    personaId: 'U123SLACK',
    label: 'Dana Reyes',
    body: 'ship it',
    assignmentId: null,
    stepId: null,
    extra: null,
    replyTo: null,
    deliberationId: null,
    importance: null,
    consumers: null,
    ...over,
  };
}

function persona(over: Partial<Persona> = {}): Persona {
  return { id: 'p1', name: 'T: QA Guardian', notification_channels: null, ...over } as Persona;
}

describe('slack channel items', () => {
  it('maps to its own lens kind, not the message catch-all', () => {
    expect(itemKind(item())).toBe('slack');
    expect(itemKind(item({ kind: 'persona' }))).toBe('message');
  });

  it('still collapses into deliberation when it belongs to one', () => {
    expect(itemKind(item({ deliberationId: 'd1' }))).toBe('deliberation');
  });

  it('clusters as talk, like conversation and unlike a system event', () => {
    const rows = buildConversation([item()]);
    expect(rows.map((r) => r.kind)).toEqual(['day', 'talk']);
  });

  it('never renders as the operator or as a generic persona', () => {
    // Even if a persona somehow resolves off the parked Slack user id.
    expect(authorName(item(), persona())).toBe('Dana Reyes');
    expect(authorName(item(), undefined)).toBe('Dana Reyes');
    expect(itemAccent(item(), persona())).toBe(AUTHOR_KIND_META.slack.accent);
  });

  it('falls back to the raw Slack user id when no display name arrived', () => {
    expect(slackAuthorName(item({ label: 'slack' }))).toBe('U123SLACK');
    expect(slackAuthorName(item({ label: 'slack', personaId: null }))).toBe('Slack');
  });
});

describe('team slack bridge derivation', () => {
  const bridged = persona({
    id: 'p-bridge',
    notification_channels: JSON.stringify([
      { type: 'slack', enabled: true, config: { channel: 'C900', teamBridge: true, teamId: 'team-1' } },
      { type: 'slack', enabled: true, config: { channel: 'C901' } },
    ]),
  });

  it('finds the bridged channel for a team', () => {
    expect(findTeamSlackBridge([bridged], 'team-1')).toEqual({ personaId: 'p-bridge', channel: 'C900' });
  });

  it('ignores plain notification channels and other teams', () => {
    expect(findTeamSlackBridge([bridged], 'team-2')).toBeNull();
    expect(findTeamSlackBridge([persona()], 'team-1')).toBeNull();
  });

  it('survives a malformed channel blob', () => {
    expect(buildTeamBridgeIndex([persona({ notification_channels: 'not json' })])).toEqual({});
  });

  it('prefers a human channel name and strips a leading hash', () => {
    const named = persona({
      id: 'p2',
      notification_channels: JSON.stringify([
        { type: 'slack', enabled: true, config: { channelName: '#ops', channel: 'C900', teamBridge: true, teamId: 't' } },
      ]),
    });
    expect(buildTeamBridgeIndex([named]).t?.channel).toBe('ops');
  });
});
