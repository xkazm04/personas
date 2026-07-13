import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { listEvents, listSubscriptions } from '@/api/overview/events';
import { listTeamChannel } from '@/api/pipeline/teamChannel';
import { toEpochUtc, parsePayload } from '@/lib/channel/eventModel';
import { listTeamMemories } from '@/api/pipeline/teamMemories';
import { silentCatch } from '@/lib/silentCatch';
import type { PersonaEvent } from '@/lib/bindings/PersonaEvent';
import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* ----------------------------------------------------------------------------
 * Red Room feed — the team's communication channel (read-only), composed from:
 *
 *  - `persona_events` (the bus): what each member EMITTED — handoffs, PR
 *    lifecycle, QA verdicts, releases. The team's conversation, verbatim.
 *  - `persona_event_subscriptions`: who LISTENS to each event type — lets the
 *    log render "addressed to" edges (X emitted → Y consumes).
 *  - `team_memories`: the shared memory ledger (decisions / constraints /
 *    learnings) — the channel's pinned knowledge.
 *  - `team_channel_messages` (C1): the channel-native authors — user
 *    directives + persona/athena/director posts — via `listTeamChannel`, so
 *    Red Room shows the same channel traffic as Collab (the surfaces share the
 *    read-model underneath, per the C-on-B decision to keep them separate but
 *    unified). Step/event/memory rows are sourced above, not re-pulled here.
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

/* The event vocabulary (toEpochUtc / eventFamily / parsePayload / memberColor)
 * moved to `@/lib/channel/eventModel` — Collab and the monitor's channel views
 * import it too, and P2 deletes this folder. Re-exported here so the Red Room's
 * own files keep compiling until then. */
export { toEpochUtc, eventFamily, parsePayload, memberColor } from '@/lib/channel/eventModel';
export type { EventFamily, ParsedPayload } from '@/lib/channel/eventModel';

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
  const [channelMsgs, setChannelMsgs] = useState<TeamChannelItem[]>([]);
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
    // C1: the channel table is the home for user directives + persona posts.
    // Pull the channel-NATIVE author kinds (directive/persona/athena/director)
    // so Red Room shows the same channel traffic as Collab — the step/event/
    // memory rows Red Room already sources from listEvents/listTeamMemories are
    // skipped here to avoid duplication.
    listTeamChannel(teamId, 200)
      .then((rows) =>
        setChannelMsgs(
          rows.filter((r) =>
            r.kind === 'directive' || r.kind === 'persona' || r.kind === 'athena' || r.kind === 'director',
          ),
        ),
      )
      .catch(silentCatch('teams/redRoom:channel'));
  }, [projectId, teamId, memberSet]);

  // Subscriptions change rarely — fetch once per member set; re-fetchable on
  // demand (e.g. after new subscriptions are wired elsewhere).
  const refreshSubscriptions = useCallback(() => {
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
    refreshSubscriptions();
  }, [refreshSubscriptions]);

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
    // Channel-native messages → event items (eventType encodes the author),
    // so the Transcript renders them with the shared row + detail modal.
    const chanItems: RedRoomItem[] = channelMsgs.map((c) => ({
      kind: 'event' as const,
      id: c.id,
      at: toEpochUtc(c.at),
      personaId: c.personaId,
      eventType:
        c.kind === 'directive' ? 'user.directive'
        : c.kind === 'persona' ? 'persona.channel_post'
        : `${c.kind}.message`,
      status: 'processed',
      consumers: [],
      summary: c.body,
      artifact: null,
      errorMessage: null,
      payloadRaw: c.extra,
    }));
    return [...evItems, ...memItems, ...chanItems].sort((a, b) => b.at - a.at);
  }, [events, memories, channelMsgs, consumersByType]);

  return { items, memories, loaded, refresh, refreshSubscriptions, projectId };
}
