/**
 * useWorkforce — the one read model behind the two-layer chat prototypes.
 *
 * Layer one shows Athena's workforce as SIGNAL (bullets, dots, glow), never as
 * prose, so it needs a single shape answering three questions at a glance:
 * which processes are live (grouped by project, only projects with an active
 * task), what is waiting on the operator (every decision-like surface the chat
 * already has, flattened), and which other threads want attention. Layer two
 * then opens any of those items at full size.
 *
 * It reads the SAME slices the existing surfaces read (fleet sessions, the
 * operative-memory digest, approvals, chat cards, the pending decision, MCP
 * requests, proactive nudges, assignments, the conversation roster), so a dot
 * here and the card behind it can never disagree.
 */

import { useMemo } from 'react';
import { companionMarkConversationRead } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { useSystemStore } from '@/stores/systemStore';
import { isActionableChatCard, useCompanionStore } from '../../companionStore';
import { isCountableNudge, nudgeSeverity } from '../../attention/attentionKinds';
import { useMcpRequestStore } from '../../mcp/mcpRequestStore';
import { useOperativeMemoryStore } from '../../orchestration/operativeMemoryStore';
import { parseDigest } from '../../orchestration/parseDigest';

/** Where an item lives in layer two. Order is the priority order. */
export type WorkItemKind =
  | 'session_request'
  | 'decision'
  | 'approval'
  | 'plan'
  | 'failure'
  | 'warning'
  | 'nudge'
  | 'assignment';

export interface WorkItem {
  id: string;
  kind: WorkItemKind;
  /** Short title for a dot tooltip or a card heading. */
  title: string;
  /** Project the item belongs to, when it has one. */
  project: string | null;
  createdAtMs: number;
}

export type ProcessTone = 'needs_you' | 'working' | 'queued' | 'idle' | 'stale';

export interface ProcessBullet {
  id: string;
  label: string;
  tone: ProcessTone;
  /** Athena herself is steering this session (autopilot / dispatched). */
  athena: boolean;
  sinceMs: number;
}

export interface ProjectLane {
  project: string;
  bullets: ProcessBullet[];
  items: WorkItem[];
  /** Worst tone in the lane: drives its colour. */
  tone: ProcessTone;
}

export interface AthenaOp {
  id: string;
  intent: string;
  status: string;
  duration: string;
}

export interface Workforce {
  lanes: ProjectLane[];
  /** Items with no project (approvals, decisions, nudges about the app). */
  looseItems: WorkItem[];
  items: WorkItem[];
  ops: AthenaOp[];
  threads: { id: string; title: string; unread: number }[];
  counts: { live: number; waiting: number; projects: number; threads: number };
}

const ACTIVE_STATES = new Set(['awaiting_input', 'stale', 'running', 'spawning', 'queued', 'idle']);

const TONE_RANK: Record<ProcessTone, number> = { needs_you: 0, stale: 1, working: 2, queued: 3, idle: 4 };

export const KIND_RANK: Record<WorkItemKind, number> = {
  session_request: 0,
  decision: 1,
  approval: 2,
  plan: 3,
  failure: 4,
  warning: 5,
  nudge: 6,
  assignment: 7,
};

function toneOf(state: string): ProcessTone {
  if (state === 'awaiting_input') return 'needs_you';
  if (state === 'stale') return 'stale';
  if (state === 'running' || state === 'spawning') return 'working';
  if (state === 'queued') return 'queued';
  return 'idle';
}

function bulletOf(s: FleetSession): ProcessBullet {
  return {
    id: s.id,
    label: s.name ?? s.title ?? s.projectLabel,
    tone: toneOf(s.state),
    athena: s.athenaActive,
    sinceMs: Number(s.lastActivityMs),
  };
}

export function useWorkforce(): Workforce {
  const sessions = useSystemStore((s) => s.fleetSessions);
  const digest = useOperativeMemoryStore((s) => s.digest);
  const mcp = useMcpRequestStore((s) => s.pendingRequests);
  const pendingDecision = useCompanionStore((s) => s.pendingDecision);
  const approvals = useCompanionStore((s) => s.approvals);
  const chatCards = useCompanionStore((s) => s.chatCards);
  const proactive = useCompanionStore((s) => s.proactive);
  const assignments = useCompanionStore((s) => s.athenaAssignments);
  const conversations = useCompanionStore((s) => s.conversations);
  const activeConversationId = useCompanionStore((s) => s.activeConversationId);

  return useMemo(() => {
    const live = sessions.filter((s) => ACTIVE_STATES.has(s.state));
    const projectOfSession = new Map(sessions.map((s) => [s.id, s.projectLabel]));

    const items: WorkItem[] = [];
    for (const r of mcp) {
      const payload = r.payload as { question?: string; action?: string };
      items.push({
        id: `mcp:${r.requestId}`,
        kind: 'session_request',
        title: payload.question ?? payload.action ?? r.kind,
        project: projectOfSession.get(r.fleetSessionId) ?? null,
        createdAtMs: r.receivedAt,
      });
    }
    if (pendingDecision) {
      items.push({ id: `decision:${pendingDecision.id}`, kind: 'decision', title: pendingDecision.prompt, project: null, createdAtMs: Date.now() });
    }
    for (const a of approvals) {
      items.push({ id: `approval:${a.id}`, kind: 'approval', title: a.action, project: null, createdAtMs: Date.parse(a.createdAt) || 0 });
    }
    chatCards.forEach((c, i) => {
      if (!isActionableChatCard(c)) return;
      items.push({ id: `card:${c.id ?? i}`, kind: 'plan', title: c.title ?? c.kind, project: null, createdAtMs: 0 });
    });
    for (const m of proactive) {
      if (!isCountableNudge(m.triggerKind)) continue;
      const sev = nudgeSeverity(m.triggerKind);
      items.push({
        id: `nudge:${m.id}`,
        kind: sev === 'errors' ? 'failure' : sev === 'warnings' ? 'warning' : 'nudge',
        title: m.message,
        project: null,
        createdAtMs: Date.parse(m.createdAt) || 0,
      });
    }
    for (const a of assignments) {
      items.push({ id: `assignment:${a.assignmentId}`, kind: 'assignment', title: a.title, project: null, createdAtMs: a.updatedAt });
    }
    items.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.createdAtMs - a.createdAtMs);

    const byProject = new Map<string, ProjectLane>();
    for (const s of live) {
      const lane = byProject.get(s.projectLabel) ?? { project: s.projectLabel, bullets: [], items: [], tone: 'idle' as ProcessTone };
      lane.bullets.push(bulletOf(s));
      byProject.set(s.projectLabel, lane);
    }
    const looseItems: WorkItem[] = [];
    for (const it of items) {
      const lane = it.project ? byProject.get(it.project) : undefined;
      if (lane) lane.items.push(it);
      else looseItems.push(it);
    }
    const lanes = [...byProject.values()].map((l) => {
      l.bullets.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
      const worst = l.items.length > 0 ? 'needs_you' : (l.bullets[0]?.tone ?? 'idle');
      return { ...l, tone: worst as ProcessTone };
    });
    // Freshest trouble first: lanes that need the operator, then by worst tone,
    // then by most bullets.
    lanes.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone] || b.bullets.length - a.bullets.length);

    const ops = parseDigest(digest)
      .filter((o) => o.status !== 'done' && o.status !== 'completed')
      .map((o) => ({ id: o.id8, intent: o.intent, status: o.status, duration: o.duration }));

    const threads = conversations
      .filter((c) => c.id !== activeConversationId && c.status !== 'archived' && Number(c.unreadCount) > 0)
      .map((c) => ({ id: c.id, title: c.title ?? c.id, unread: Number(c.unreadCount) }));

    return {
      lanes,
      looseItems,
      items,
      ops,
      threads,
      counts: { live: live.length, waiting: items.length, projects: lanes.length, threads: threads.length },
    };
  }, [sessions, digest, mcp, pendingDecision, approvals, chatCards, proactive, assignments, conversations, activeConversationId]);
}

/** Switch to another thread and mark it read, as the header switcher does. */
export function switchThread(id: string) {
  const store = useCompanionStore.getState();
  const row = store.conversations.find((c) => c.id === id);
  if (!row || id === store.activeConversationId) return;
  store.setActiveConversationId(id);
  if (row.unreadCount > 0n) {
    store.upsertConversation({ ...row, unreadCount: 0n });
    companionMarkConversationRead(id).catch(silentCatch('companion_mark_conversation_read'));
  }
}
