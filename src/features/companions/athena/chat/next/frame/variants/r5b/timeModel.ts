/**
 * The time spine's read model: every run thread as a LANE on a one-hour axis
 * (now at the top), with what it did as segments and what waits on the
 * operator as GATE marks at the moment the gate opened.
 *
 * Built only from data the app already holds (`useWorkforce` for lanes and
 * waiting items, the fleet sessions for their clocks, the MCP store to put a
 * session's request on that session's lane, the transcript for Athena's own
 * rhythm). A fleet session carries its creation time, its last activity and its
 * current state, not a state history, so a lane reads honestly as: active from
 * its start (or the hour's edge) until its last activity, then in its current
 * state since. A queued session is queued since it was queued.
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect, useMemo, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { useMcpRequestStore } from '../../../../../mcp/mcpRequestStore';
import type { CompanionMessage } from '@/api/companion';
import { KIND_RANK, type WorkItem, type WorkItemKind, type Workforce } from '../../../useWorkforce';

export const HOUR = 3_600_000;

export type LaneTone = 'working' | 'queued' | 'idle' | 'stale' | 'gate';
export type MarkKind = WorkItemKind | 'input';

export interface Seg { from: number; to: number; tone: LaneTone }
export interface Mark {
  id: string;
  /** The work item it opens, or null for a session that waits in its own terminal. */
  itemId: string | null;
  kind: MarkKind;
  /** Blocks on the operator (decide / approve / answer). Notices are marks, not gates. */
  gate: boolean;
  at: number;
}
export interface Lane {
  id: string;
  /** null = Athena's own lane. */
  project: string | null;
  name: string;
  tone: LaneTone;
  /** Since when the lane is in its current state. */
  since: number;
  segs: Seg[];
  marks: Mark[];
  /** Athena's lane only: your asks and her replies, as ticks. */
  beats: { at: number; who: 'you' | 'her' }[];
  sessionId: string | null;
}
export interface TimeModel {
  now: number;
  lanes: Lane[];
  /** Every gate on every lane, in the queue's priority order. */
  gates: Mark[];
}

const GATE_KINDS: ReadonlySet<MarkKind> = new Set(['session_request', 'decision', 'approval', 'plan', 'input']);

/** A clock for render: ticks every 15 s so the axis drifts with real time. */
export function useNow(stepMs = 15_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(id);
  }, [stepMs]);
  return now;
}

/** "started 39m ago" / "1h 5m" / "45s" -> milliseconds, or null. */
function parseAgo(text: string): number | null {
  let ms = 0;
  for (const [, n, u] of text.matchAll(/(\d+)\s*(h|m|s)\b/g)) ms += Number(n) * (u === 'h' ? HOUR : u === 'm' ? 60_000 : 1000);
  return ms > 0 ? ms : null;
}

function sessionSegs(state: string, start: number, last: number, queued: number | null, now: number): { segs: Seg[]; tone: LaneTone; since: number } {
  const lastAt = Math.min(now, Math.max(start, last));
  const after = (tone: LaneTone): { segs: Seg[]; tone: LaneTone; since: number } => ({
    segs: [{ from: start, to: lastAt, tone: 'working' }, { from: lastAt, to: now, tone }],
    tone,
    since: lastAt,
  });
  if (state === 'running' || state === 'spawning') return { segs: [{ from: start, to: now, tone: 'working' }], tone: 'working', since: start };
  if (state === 'queued') {
    const q = queued ?? start;
    return { segs: [{ from: q, to: now, tone: 'queued' }], tone: 'queued', since: q };
  }
  if (state === 'awaiting_input') return after('gate');
  if (state === 'stale') return after('stale');
  return after('idle');
}

const markOf = (it: WorkItem, now: number): Mark => ({
  id: it.id,
  itemId: it.id,
  kind: it.kind,
  gate: GATE_KINDS.has(it.kind),
  at: it.createdAtMs > 0 ? Math.min(now, it.createdAtMs) : now,
});

export function useTimeModel(workforce: Workforce, messages: CompanionMessage[], streaming: boolean): TimeModel {
  const sessions = useSystemStore((s) => s.fleetSessions);
  const requests = useMcpRequestStore((s) => s.pendingRequests);
  const now = useNow();

  return useMemo(() => {
    const byId = new Map(sessions.map((s) => [s.id, s]));
    const sessionOfRequest = new Map(requests.map((r) => [`mcp:${r.requestId}`, r.fleetSessionId]));
    const edge = now - HOUR;
    const lanes: Lane[] = [];

    // Athena first: her ops as working spans, her conversation as beats.
    const athena: Lane = { id: 'athena', project: null, name: '', tone: 'idle', since: edge, segs: [], marks: [], beats: [], sessionId: null };
    for (const op of workforce.ops) {
      const ago = parseAgo(op.duration);
      if (ago !== null) athena.segs.push({ from: Math.max(edge, now - ago), to: now, tone: 'working' });
    }
    for (const m of messages) {
      const at = Date.parse(m.createdAt);
      if (!(at > edge)) continue;
      if (m.role === 'user') athena.beats.push({ at, who: 'you' });
      else if (m.role === 'assistant' && !m.content.trimStart().startsWith('PROGRESS:')) athena.beats.push({ at, who: 'her' });
    }
    if (streaming) {
      const lastAsk = [...athena.beats].reverse().find((b) => b.who === 'you');
      athena.segs.push({ from: lastAsk?.at ?? now - 60_000, to: now, tone: 'working' });
      athena.tone = 'working';
    } else if (athena.segs.length) athena.tone = 'working';
    lanes.push(athena);

    const laneOfSession = new Map<string, Lane>();
    for (const project of workforce.lanes) {
      for (const b of project.bullets) {
        const s = byId.get(b.id);
        if (!s) continue;
        const start = Math.max(edge, Number(s.createdAtMs));
        const { segs, tone, since } = sessionSegs(s.state, start, Number(s.lastActivityMs), s.queuedAtMs ?? null, now);
        const lane: Lane = { id: s.id, project: project.project, name: b.label, tone, since, segs, marks: [], beats: [], sessionId: s.id };
        laneOfSession.set(s.id, lane);
        lanes.push(lane);
      }
    }

    for (const it of workforce.items) {
      const sid = sessionOfRequest.get(it.id);
      const lane = (sid && laneOfSession.get(sid)) || athena;
      lane.marks.push(markOf(it, now));
    }
    // A session waiting in its own terminal, with no request item, is still a gate.
    for (const lane of laneOfSession.values()) {
      if (lane.tone === 'gate' && !lane.marks.some((m) => m.gate)) {
        lane.marks.push({ id: `input:${lane.id}`, itemId: null, kind: 'input', gate: true, at: lane.since });
      }
    }
    if (athena.marks.some((m) => m.gate)) athena.tone = 'gate';

    const rank = (m: Mark) => (m.kind === 'input' ? KIND_RANK.session_request : KIND_RANK[m.kind]);
    const gates = lanes
      .flatMap((l) => l.marks.filter((m) => m.gate))
      .sort((a, b) => rank(a) - rank(b) || a.at - b.at);
    return { now, lanes, gates };
  }, [sessions, requests, workforce, messages, streaming, now]);
}

/** Fraction down the axis (0 = now, 1 = an hour ago or older). */
export function depth(now: number, at: number): number {
  return Math.min(1, Math.max(0, (now - at) / HOUR));
}

export function minutesAgo(now: number, at: number): number {
  return Math.max(0, Math.round((now - at) / 60_000));
}
