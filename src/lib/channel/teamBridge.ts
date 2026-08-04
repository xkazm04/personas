import type { Persona } from '@/lib/bindings/Persona';

/* ----------------------------------------------------------------------------
 * TEAM ↔ SLACK BRIDGE — the read-only derivation.
 *
 * A bridge is not its own entity. It is an ordinary shape-v2 notification
 * channel on a persona (`personas.notification_channels`, a JSON array of
 * `ChannelSpecV2`) that has been marked with two config flags:
 *
 *     config.teamBridge === true      // this channel is a team bridge
 *     config.teamId     === <teamId>  // …for this team
 *
 * Storing it there rather than on the team row is what lets the existing Slack
 * poller keep working unchanged — it already sweeps `notification_channels` and
 * needs no notion of "teams". The cost is that ANY surface wanting to know
 * "is this team bridged?" has to derive it from the personas it already holds,
 * which is exactly what this module is for.
 *
 * Pure: no React, no store, no IPC. Parse failures are non-events — an
 * unparseable channel blob means "no bridge", never a thrown render.
 * -------------------------------------------------------------------------- */

/** A team's inbound Slack bridge, as derived from a persona's channel specs. */
export interface TeamSlackBridge {
  /** The persona whose notification channel carries the bridge. */
  personaId: string;
  /** Display label for the chip — a channel name if we have one, else its id.
   *  Empty when the spec names no destination at all. */
  channel: string;
}

/** The keys a Slack channel spec may use for its destination. The messaging
 *  picker writes `channel`; agent_ir and older shapes wrote `channelId` /
 *  `channel_id`. A human-readable `channelName`, when present, wins. */
const CHANNEL_KEYS = ['channelName', 'channel', 'channelId', 'channel_id'] as const;

type ChannelSpecLike = { type?: unknown; channel?: unknown; enabled?: unknown; config?: unknown };

function parseSpecs(raw: string | null): ChannelSpecLike[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed.filter((s) => !!s && typeof s === 'object') as ChannelSpecLike[]) : [];
  } catch {
    return []; // malformed channel blob = no bridge; the editor owns that error
  }
}

function bridgeConfig(spec: ChannelSpecLike): Record<string, unknown> | null {
  // agent_ir writes the discriminant as `channel`; the frontend as `type`.
  if ((spec.type ?? spec.channel) !== 'slack') return null;
  if (spec.enabled === false) return null;
  const config = spec.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const c = config as Record<string, unknown>;
  return c.teamBridge === true && typeof c.teamId === 'string' && c.teamId ? c : null;
}

function channelLabel(config: Record<string, unknown>): string {
  for (const key of CHANNEL_KEYS) {
    const v = config[key];
    if (typeof v === 'string' && v.trim()) return v.trim().replace(/^#/, '');
  }
  return '';
}

/**
 * Every bridged team, keyed by team id. ONE pass over the personas, so a surface
 * holding many teams never re-parses the same JSON per team.
 *
 * First enabled match wins — a team is bridged to at most one channel by design,
 * and two competing entries is a misconfiguration we resolve to "the first one"
 * rather than surface as an error the monitor could not act on anyway.
 */
export function buildTeamBridgeIndex(personas: Persona[]): Record<string, TeamSlackBridge> {
  const index: Record<string, TeamSlackBridge> = {};
  for (const persona of personas) {
    for (const spec of parseSpecs(persona.notification_channels)) {
      const config = bridgeConfig(spec);
      if (!config) continue;
      const teamId = config.teamId as string;
      if (index[teamId]) continue;
      index[teamId] = { personaId: persona.id, channel: channelLabel(config) };
    }
  }
  return index;
}

/** The Slack bridge for one team, or null. */
export function findTeamSlackBridge(personas: Persona[], teamId: string | null): TeamSlackBridge | null {
  if (!teamId) return null;
  return buildTeamBridgeIndex(personas)[teamId] ?? null;
}
