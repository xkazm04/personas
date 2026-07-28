import type { PersonaTeamConnection } from '@/lib/bindings/PersonaTeamConnection';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { toEpochUtc } from '@/lib/channel/eventModel';

/* ----------------------------------------------------------------------------
 * MAP MODEL — the Constellation's pure layout math.
 *
 * A team renders as a radial field: the orchestrator at the core, everyone
 * else on a ring around it, grouped into ANGULAR SECTORS by role. Sector arc
 * is proportional to population (a crowded role gets more arc, not more
 * rings), a rule lifted from the albert console's zone allocator — it keeps
 * "distance from center" meaning ROLE DEPTH, never group size.
 *
 * All jitter is deterministic (FNV-1a over the persona id): a rebuild must
 * not reshuffle the field under the reader's cursor, so Math.random is not an
 * option here.
 *
 * Pure: no React, no store, no IPC.
 * -------------------------------------------------------------------------- */

export interface MapMemberInput {
  memberId: string;
  personaId: string;
  role: string;
  name: string;
  color: string;
}

export interface MapNode {
  personaId: string;
  memberId: string;
  name: string;
  color: string;
  role: string;
  x: number;
  y: number;
  core: boolean;
}

export interface StructureEdge {
  from: string; // personaId
  to: string;
  type: string;
}

export interface TrafficEdge {
  from: string; // personaId
  to: string;
  /** Epoch ms of the NEWEST event on this route (drives fade). */
  at: number;
  count: number;
}

/** How long a channel event keeps its route glowing on the map. */
export const TRAFFIC_WINDOW_MS = 10 * 60 * 1000;

/** Sector ordering — orchestrator is the core, never a sector. */
const ROLE_ORDER = ['worker', 'reviewer', 'router'];

/** FNV-1a hash normalized to [0, 1). Stable across rebuilds. */
export function hashUnit(s: string, salt = 0): number {
  let h = 0x811c9dc5 ^ salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 0x100000000;
}

/**
 * Pick the core member: the orchestrator role if present, else the member
 * with the highest out-degree in the connection graph, else the first.
 */
export function pickCore(members: MapMemberInput[], connections: PersonaTeamConnection[]): MapMemberInput | null {
  if (members.length === 0) return null;
  const orch = members.find((m) => m.role === 'orchestrator');
  if (orch) return orch;
  const out = new Map<string, number>();
  for (const c of connections) out.set(c.source_member_id, (out.get(c.source_member_id) ?? 0) + 1);
  let best = members[0]!;
  let bestDeg = out.get(best.memberId) ?? 0;
  for (const m of members) {
    const d = out.get(m.memberId) ?? 0;
    if (d > bestDeg) {
      best = m;
      bestDeg = d;
    }
  }
  return best;
}

/**
 * Radial layout inside a w×h box. Core at center; satellites on a ring in
 * role-proportional sectors starting at 12 o'clock, with deterministic
 * per-node radial jitter so dense sectors read organic rather than gridded.
 */
export function buildConstellation(
  members: MapMemberInput[],
  connections: PersonaTeamConnection[],
  w: number,
  h: number,
): { nodes: MapNode[]; structure: StructureEdge[]; core: MapNode | null } {
  const cx = w / 2;
  const cy = h / 2;
  const core = pickCore(members, connections);
  const nodes: MapNode[] = [];

  if (core) {
    nodes.push({ ...core, x: cx, y: cy, core: true });
  }

  const sats = members.filter((m) => m.memberId !== core?.memberId);

  // Group satellites by role, in a stable order (known roles first).
  const groups = new Map<string, MapMemberInput[]>();
  for (const m of sats) {
    const arr = groups.get(m.role) ?? [];
    arr.push(m);
    groups.set(m.role, arr);
  }
  const roleKeys = [...groups.keys()].sort((a, b) => {
    const ia = ROLE_ORDER.indexOf(a);
    const ib = ROLE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

  // Arc per group ∝ population (+0.6 so a lone member never gets a slit),
  // with a fixed dead gap between neighbouring sectors.
  const GAP = (8 * Math.PI) / 180;
  const totalWeight = roleKeys.reduce((s, k) => s + groups.get(k)!.length + 0.6, 0);
  const totalArc = 2 * Math.PI - GAP * Math.max(1, roleKeys.length);
  const R = Math.min(w, h) * 0.36;

  let angle = -Math.PI / 2; // 12 o'clock
  for (const key of roleKeys) {
    const group = groups.get(key)!;
    const arc = ((group.length + 0.6) / totalWeight) * totalArc;
    // Evenly space the group's nodes across its sector, centered.
    const step = arc / group.length;
    group.forEach((m, i) => {
      const a = angle + step * (i + 0.5);
      const r = R * (1 + (hashUnit(m.personaId) - 0.5) * 0.14);
      nodes.push({ ...m, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, core: false });
    });
    angle += arc + GAP;
  }

  // Structural edges, translated member-id → persona-id (the traffic layer
  // speaks persona ids, so the whole map does).
  const personaByMember = new Map(members.map((m) => [m.memberId, m.personaId]));
  const structure: StructureEdge[] = [];
  for (const c of connections) {
    const from = personaByMember.get(c.source_member_id);
    const to = personaByMember.get(c.target_member_id);
    if (!from || !to || from === to) continue;
    structure.push({ from, to, type: c.connection_type ?? '' });
  }

  return { nodes, structure, core: nodes.find((n) => n.core) ?? null };
}

/**
 * Live routes from recent channel traffic: an event row fans out from its
 * author to every subscribed consumer ("Heard by"). Routes are deduped and
 * anchored at their newest event; anything older than TRAFFIC_WINDOW_MS is
 * gone — the map shows what is happening, not an archive.
 */
export function trafficEdges(
  items: TeamChannelItem[],
  memberPersonaIds: Set<string>,
  now: number,
): TrafficEdge[] {
  const routes = new Map<string, TrafficEdge>();
  for (const i of items) {
    if (i.kind !== 'event' || !i.personaId || !i.consumers?.length) continue;
    const at = toEpochUtc(i.at);
    if (now - at > TRAFFIC_WINDOW_MS) continue;
    if (!memberPersonaIds.has(i.personaId)) continue;
    for (const to of i.consumers) {
      if (to === i.personaId || !memberPersonaIds.has(to)) continue;
      const key = `${i.personaId}→${to}`;
      const prev = routes.get(key);
      if (prev) {
        prev.count += 1;
        if (at > prev.at) prev.at = at;
      } else {
        routes.set(key, { from: i.personaId, to, at, count: 1 });
      }
    }
  }
  return [...routes.values()].sort((a, b) => b.at - a.at);
}
