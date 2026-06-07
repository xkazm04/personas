import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { listEvents, listSubscriptions } from '@/api/overview/events';
import { listTeamMemories } from '@/api/pipeline/teamMemories';
import { silentCatch } from '@/lib/silentCatch';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';

/* ----------------------------------------------------------------------------
 * Red Room feed — the team's communication channel, composed ENTIRELY from
 * existing data (v1, read-only):
 *
 *  - `persona_events` (the bus): what each member EMITTED — handoffs, PR
 *    lifecycle, QA verdicts, releases. The team's conversation, verbatim.
 *  - `persona_event_subscriptions`: who LISTENS to each event type — lets the
 *    log render "addressed to" edges (X emitted → Y consumes).
 *  - `team_memories`: the shared memory ledger (decisions / constraints /
 *    learnings) — the channel's pinned knowledge.
 *
 * Events are project-scoped (`persona_events.project_id`) and teams link to
 * projects via `dev_projects.team_id`; member-id filtering is applied on top
 * as belt-and-suspenders (and as the only filter when no project is linked).
 * -------------------------------------------------------------------------- */

export interface RedRoomEventItem {
  kind: 'event';
  id: string;
  /** Epoch ms (normalized — events are RFC3339, memories are SQLite naive UTC). */
  at: number;
  /** Emitting persona (persona_events.source_id). */
  personaId: string | null;
  eventType: string;
  status: string;
  /** Member persona ids whose subscriptions match this event type. */
  consumers: string[];
  /** One-line human summary extracted from the payload. */
  summary: string | null;
  /** First URL-ish artifact found in the payload (PR link, run link…). */
  artifact: { url: string; label: string } | null;
  errorMessage: string | null;
  /** Raw payload (JSON or text) — the detail modal shows it in full. */
  payloadRaw: string | null;
}

export interface RedRoomMemoryItem {
  kind: 'memory';
  id: string;
  at: number;
  personaId: string | null;
  title: string;
  content: string;
  category: string;
  importance: number;
}

export type RedRoomItem = RedRoomEventItem | RedRoomMemoryItem;

/** Parse either RFC3339 or SQLite naive-UTC ("YYYY-MM-DD HH:MM:SS") to epoch ms. */
export function toEpochUtc(s: string): number {
  if (!s) return 0;
  const hasTz = /[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s);
  const iso = hasTz ? s : `${s.replace(' ', 'T')}Z`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}

/** Visual family for an event type — drives the channel's colour coding. */
export function eventFamily(eventType: string): 'handoff' | 'pr' | 'qa' | 'release' | 'failure' | 'build' | 'other' {  // 'note' is the memory pseudo-family, assigned by item kind
  const e = eventType.toLowerCase();
  if (e.includes('fail') || e.includes('error')) return 'failure';
  if (e.startsWith('team_handoff')) return 'handoff';
  if (e.includes('.pr.') || e.endsWith('.pr')) return 'pr';
  if (e.startsWith('qa.')) return 'qa';
  if (e.startsWith('release.') || e.includes('published') || e.includes('version')) return 'release';
  if (e.includes('implementation') || e.includes('architecture') || e.includes('docs') || e.includes('scan')) return 'build';
  return 'other';
}

interface ParsedPayload {
  summary: string | null;
  artifact: { url: string; label: string } | null;
}

/** Best-effort extraction of a human line + a link artifact from an event payload. */
export function parsePayload(payload: string | null): ParsedPayload {
  if (!payload) return { summary: null, artifact: null };
  try {
    const p: unknown = JSON.parse(payload);
    if (typeof p === 'string') return { summary: p.slice(0, 280), artifact: null };
    if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>;
      const summary =
        firstString(o, ['summary', 'message', 'title', 'description', 'reason', 'task', 'goal']) ??
        null;
      const url = firstString(o, ['pr_url', 'prUrl', 'html_url', 'url', 'link', 'run_url']);
      const branch = firstString(o, ['branch', 'head', 'ref']);
      const artifact = url
        ? { url, label: url.includes('/pull/') ? `PR ${url.split('/pull/')[1] ?? ''}`.trim() : branch ?? shortUrl(url) }
        : null;
      return { summary: summary ? summary.slice(0, 280) : null, artifact };
    }
  } catch {
    // not JSON — treat the raw payload as the summary line
    return { summary: payload.slice(0, 280), artifact: null };
  }
  return { summary: null, artifact: null };
}

function firstString(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').slice(0, 40);
}

/* ----------------------------------------------------------------------------
 * Universal member colour — one colour per team member, everywhere.
 * Primary source is the persona's own `color` (the same hue the roster dots,
 * canvas nodes and editor use), so the Red Room agrees with the rest of the
 * app. Personas without a colour get a stable palette pick hashed from their
 * id, so the assignment never shifts between renders or sessions.
 * -------------------------------------------------------------------------- */

const MEMBER_FALLBACK_PALETTE = [
  '#a78bfa', '#60a5fa', '#fbbf24', '#34d399', '#f87171',
  '#38bdf8', '#fb923c', '#e879f9', '#4ade80', '#f472b6',
];

export function memberColor(persona: { color?: string | null } | undefined, personaId: string | null): string {
  if (persona?.color) return persona.color;
  if (!personaId) return '#9ca3af';
  let h = 0;
  for (let i = 0; i < personaId.length; i++) h = (h * 31 + personaId.charCodeAt(i)) >>> 0;
  return MEMBER_FALLBACK_PALETTE[h % MEMBER_FALLBACK_PALETTE.length]!;
}

const POLL_MS = 10_000;
const EVENT_LIMIT = 500;

export function useRedRoomFeed(teamId: string, memberPersonaIds: string[]) {
  const projects = useSystemStore((s) => s.projects);
  const projectId = useMemo(
    () => projects.find((p) => p.team_id === teamId)?.id ?? null,
    [projects, teamId],
  );

  const [events, setEvents] = useState<PersonaEvent[]>([]);
  const [memories, setMemories] = useState<TeamMemory[]>([]);
  const [consumersByType, setConsumersByType] = useState<Map<string, string[]>>(new Map());
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const memberSet = useMemo(() => new Set(memberPersonaIds), [memberPersonaIds]);

  const refresh = useCallback(() => {
    // Fetch UNSCOPED recent events and filter client-side: emitted by a member,
    // addressed to a member, or stamped with the team's project. (A purely
    // project-scoped query proved too narrow in practice — bus events from
    // team executions don't reliably carry the dev project's id.)
    listEvents(EVENT_LIMIT)
      .then((rows) => {
        const keep = rows.filter(
          (e) =>
            (e.source_id && memberSet.has(e.source_id)) ||
            (e.target_persona_id && memberSet.has(e.target_persona_id)) ||
            (projectId !== null && e.project_id === projectId),
        );
        setEvents(keep);
        setLoaded(true);
      })
      .catch(silentCatch('teams/redRoom:events'));
    listTeamMemories(teamId, undefined, undefined, undefined, 100)
      .then(setMemories)
      .catch(silentCatch('teams/redRoom:memories'));
  }, [projectId, teamId, memberSet]);

  // Subscriptions change rarely — fetch once per member set.
  useEffect(() => {
    if (memberPersonaIds.length === 0) return;
    Promise.all(
      memberPersonaIds.map((pid) =>
        listSubscriptions(pid).then((subs) => ({ pid, subs })).catch(() => ({ pid, subs: [] })),
      ),
    )
      .then((all) => {
        const map = new Map<string, string[]>();
        for (const { pid, subs } of all) {
          for (const sub of subs) {
            const key = sub.event_type;
            const arr = map.get(key) ?? [];
            if (!arr.includes(pid)) arr.push(pid);
            map.set(key, arr);
          }
        }
        setConsumersByType(map);
      })
      .catch(silentCatch('teams/redRoom:subs'));
    // join() gives a stable dependency for the same member set
  }, [memberPersonaIds.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setLoaded(false);
    refresh();
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(refresh, POLL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [refresh]);

  const items: RedRoomItem[] = useMemo(() => {
    const evItems: RedRoomItem[] = events.map((e) => {
      const { summary, artifact } = parsePayload(e.payload);
      return {
        kind: 'event' as const,
        id: e.id,
        at: toEpochUtc(e.created_at),
        personaId: e.source_id,
        eventType: e.event_type,
        status: e.status as string,
        consumers: (consumersByType.get(e.event_type) ?? []).filter((pid) => pid !== e.source_id),
        summary,
        artifact,
        errorMessage: e.error_message,
        payloadRaw: e.payload,
      };
    });
    const memItems: RedRoomItem[] = memories.map((m) => ({
      kind: 'memory' as const,
      id: m.id,
      at: toEpochUtc(m.created_at),
      personaId: m.persona_id,
      title: m.title,
      content: m.content,
      category: m.category,
      importance: m.importance,
    }));
    return [...evItems, ...memItems].sort((a, b) => b.at - a.at);
  }, [events, memories, consumersByType]);

  return { items, memories, loaded, refresh, projectId };
}
