import type { ChannelSpecV2 } from '@/lib/bindings/ChannelSpecV2';

/* ----------------------------------------------------------------------------
 * TEAM ↔ SLACK BRIDGE — the WRITE half.
 *
 * `teamBridge.ts` (next door) derives bridges for read-only surfaces. This
 * module is the editor's counterpart: it reads ONE team's bridge out of a
 * persona's `notification_channels` blob and merges an edited bridge back in
 * WITHOUT touching any other channel spec on that persona.
 *
 * Two invariants make this delicate enough to deserve its own pure module and
 * its own tests:
 *
 *   1. A persona's Slack notification channels are NOT all bridges. Only the
 *      ones carrying `config.teamBridge === true` are. An ordinary Slack
 *      notification spec sitting next to a bridge must survive every write
 *      byte-for-byte, or wiring a team bridge silently breaks someone's alerts.
 *
 *   2. `parse_channels_v2` (core/src/models/persona.rs) decides "is this blob
 *      shape v2?" by looking at the FIRST element for `use_case_ids`, and then
 *      requires the WHOLE array to deserialize as `Vec<ChannelSpecV2>`. So a
 *      legacy shape-A (object) or shape-B (array without `use_case_ids`) blob
 *      cannot host a bridge: appending one either leaves it invisible or breaks
 *      the legacy parse for the specs already there. We refuse rather than
 *      corrupt — see `upsertTeamBridgeSpec`'s `legacy_shape` result.
 *
 * Pure: no React, no store, no IPC.
 * -------------------------------------------------------------------------- */

/** The editable state of one team's bridge. */
export interface TeamBridgeDraft {
  teamId: string;
  /** Vault credential id for the Slack connector carrying the bridge. */
  credentialId: string;
  /** Slack channel id (e.g. `C01234ABC`). */
  channel: string;
  /** Human-readable channel name, stored for display only. */
  channelName?: string | null;
  pollInbound: boolean;
  outboundMessages: boolean;
  outboundDirectives: boolean;
  outboundSteps: boolean;
}

/** Result of a merge attempt. `legacy_shape` means the persona's blob predates
 *  shape v2 and cannot host a bridge without breaking its existing channels. */
export type BridgeMergeResult =
  | { ok: true; json: string }
  | { ok: false; reason: 'legacy_shape' };

type SpecLike = Record<string, unknown>;

/** Parse the blob into a v2 spec array, or `null` when it is not shape v2.
 *  `null`/blank is treated as "empty v2 array" — a fresh persona can be
 *  bridged. */
export function parseV2Specs(raw: string | null | undefined): SpecLike[] | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return [];
  if (!trimmed.startsWith('[')) return null; // shape A object
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null; // malformed — never guess, never overwrite
  }
  if (!Array.isArray(parsed)) return null;
  const specs = parsed.filter((s): s is SpecLike => !!s && typeof s === 'object' && !Array.isArray(s));
  if (specs.length !== parsed.length) return null;
  const first = specs[0];
  if (!first) return [];
  // The same discriminant the Rust parser uses.
  if (!('use_case_ids' in first)) return null; // shape B legacy
  return specs;
}

function configOf(spec: SpecLike): Record<string, unknown> | null {
  const config = spec.config;
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  return config as Record<string, unknown>;
}

function readBool(config: Record<string, unknown>, keys: string[]): boolean {
  for (const key of keys) {
    if (typeof config[key] === 'boolean') return config[key] as boolean;
  }
  return false;
}

function readStr(config: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** True when this spec is the bridge for `teamId`. Deliberately ignores
 *  `enabled` so an edit replaces a disabled bridge instead of duplicating it. */
function isBridgeFor(spec: SpecLike, teamId: string): boolean {
  if (spec.type !== 'slack') return false;
  const config = configOf(spec);
  if (!config) return false;
  if (!readBool(config, ['teamBridge', 'team_bridge'])) return false;
  return readStr(config, ['teamId', 'team_id']) === teamId;
}

/** The team's bridge as stored on this persona, or `null`. */
export function readTeamBridgeSpec(raw: string | null | undefined, teamId: string): TeamBridgeDraft | null {
  const specs = parseV2Specs(raw);
  if (!specs) return null;
  const spec = specs.find((s) => isBridgeFor(s, teamId));
  if (!spec) return null;
  const config = configOf(spec) ?? {};
  const channelName = readStr(config, ['channelName', 'channel_name']);
  return {
    teamId,
    credentialId: typeof spec.credential_id === 'string' ? spec.credential_id : '',
    channel: readStr(config, ['channel', 'channelId', 'channel_id']),
    channelName: channelName || null,
    pollInbound: readBool(config, ['pollInbound', 'poll_inbound']),
    outboundMessages: readBool(config, ['outboundMessages', 'outbound_messages']),
    outboundDirectives: readBool(config, ['outboundDirectives', 'outbound_directives']),
    outboundSteps: readBool(config, ['outboundSteps', 'outbound_steps']),
  };
}

/** Build the `ChannelSpecV2` entry for a bridge. Scope is `"*"`: a bridge is a
 *  team-level wire, not a per-use-case notification. */
export function buildBridgeSpec(draft: TeamBridgeDraft): ChannelSpecV2 {
  return {
    type: 'slack',
    enabled: true,
    credential_id: draft.credentialId,
    use_case_ids: '*',
    event_filter: null,
    config: {
      teamBridge: true,
      teamId: draft.teamId,
      channel: draft.channel,
      ...(draft.channelName ? { channelName: draft.channelName } : {}),
      pollInbound: draft.pollInbound,
      outboundMessages: draft.outboundMessages,
      outboundDirectives: draft.outboundDirectives,
      outboundSteps: draft.outboundSteps,
    },
  };
}

/** Merge a bridge into the blob, replacing an existing bridge for the same team
 *  in place and leaving every other spec untouched. */
export function upsertTeamBridgeSpec(raw: string | null | undefined, draft: TeamBridgeDraft): BridgeMergeResult {
  const specs = parseV2Specs(raw);
  if (!specs) return { ok: false, reason: 'legacy_shape' };
  const next = buildBridgeSpec(draft) as unknown as SpecLike;
  const index = specs.findIndex((s) => isBridgeFor(s, draft.teamId));
  const merged = index >= 0 ? specs.map((s, i) => (i === index ? next : s)) : [...specs, next];
  return { ok: true, json: JSON.stringify(merged) };
}

/** Drop the team's bridge from the blob. Every other spec survives. */
export function removeTeamBridgeSpec(raw: string | null | undefined, teamId: string): BridgeMergeResult {
  const specs = parseV2Specs(raw);
  if (!specs) return { ok: false, reason: 'legacy_shape' };
  return { ok: true, json: JSON.stringify(specs.filter((s) => !isBridgeFor(s, teamId))) };
}
