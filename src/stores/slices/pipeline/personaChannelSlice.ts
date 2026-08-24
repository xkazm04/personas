import type { StateCreator } from "zustand";
import type { PipelineStore } from "../../storeTypes";

import {
  listPersonaChannel,
  postPersonaChannelMessage,
} from "@/api/pipeline/personaChannel";
import { silentCatch } from "@/lib/silentCatch";
import type { PersonaChannelItem } from "@/lib/bindings/PersonaChannelItem";
import { mergeHeadBy } from "./channelSlice";

/* ----------------------------------------------------------------------------
 * PERSONA CHANNEL SLICE — the single owner of persona-conversation state.
 *
 * A SEPARATE record rather than persona-prefixed keys inside `channels`, on
 * purpose: `PersonaChannelItem` and `TeamChannelItem` are different shapes
 * (reportId/reviewId/severity/suggestedActions/authorKind vs label/assignmentId/
 * deliberationId/consumers), so sharing the record would force a lossy mapping
 * or a union type through every team-channel selector, `sameItem` walk and
 * merge-horizon computation. Keeping the state type honest costs one small
 * sibling slice that reuses the SAME mechanics: `mergeHeadBy` structural
 * refresh (C1), refcounted subscriptions, composite keyset paging, and the
 * localStorage last-seen watermark (D6) under a `persona:`-namespaced key.
 *
 * Refresh is driven by the same single service (`useChannelService`), which
 * adds one PERSONA_CHANNEL_MESSAGE listener that refreshes ONLY the announced
 * persona's channel.
 * -------------------------------------------------------------------------- */

/** Rows fetched per page (matches the team channel's page). */
export const PERSONA_CHANNEL_PAGE = 60;

const LAST_SEEN_PREFIX = "personas.channel.lastSeen.persona:";

export interface PersonaChannelState {
  items: PersonaChannelItem[];
  loaded: boolean;
  /** No older rows exist — the start of this channel's history. */
  exhausted: boolean;
  posting: boolean;
  /** Newest `at` the user has actually looked at. Null = never. */
  lastSeenAt: string | null;
  /**
   * Optimistic user rows not yet confirmed by a server read. They live BESIDE
   * `items`, not in them: `mergeHeadBy` drops any cached row newer than the
   * head's oldest that the server did not return — which is exactly what an
   * un-flushed echo looks like. The view overlays them; a refresh that brings
   * the server row with the same id retires the echo here.
   */
  echoes: PersonaChannelItem[];
}

export const EMPTY_PERSONA_CHANNEL: PersonaChannelState = {
  items: [],
  loaded: false,
  exhausted: false,
  posting: false,
  lastSeenAt: null,
  echoes: [],
};

/** Read the persisted last-seen watermark (exported for the sidebar rows,
 *  which need unread state before the full channel is ever subscribed). */
export function readPersonaLastSeen(personaId: string): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_PREFIX + personaId);
  } catch {
    return null;
  }
}

function writeLastSeen(personaId: string, at: string): void {
  try {
    localStorage.setItem(LAST_SEEN_PREFIX + personaId, at);
  } catch (e) {
    silentCatch("personas/channel:last-seen-write")(e);
  }
}

/** All `PersonaChannelItem` fields are primitives — a flat field walk. */
function samePersonaItem(a: PersonaChannelItem, b: PersonaChannelItem): boolean {
  return (
    a.id === b.id && a.kind === b.kind && a.at === b.at && a.authorKind === b.authorKind &&
    a.title === b.title && a.body === b.body && a.reportId === b.reportId &&
    a.reviewId === b.reviewId && a.severity === b.severity &&
    a.suggestedActions === b.suggestedActions && a.executionId === b.executionId &&
    a.replyTo === b.replyTo && a.extra === b.extra
  );
}

/**
 * Unread = items newer than the watermark that the user did not write.
 * (Reports, reviews, events and memories are all persona output, so they
 * count; only the user's own chat rows are excluded.)
 */
export function countPersonaUnread(state: PersonaChannelState): number {
  let n = 0;
  for (const i of state.items) {
    if (i.kind === "chat" && i.authorKind === "user") continue;
    if (state.lastSeenAt !== null && i.at <= state.lastSeenAt) continue;
    n += 1;
  }
  return n;
}

/** Mint an optimistic user chat row. Exported for the view + tests. */
export function makeEcho(clientId: string, body: string): PersonaChannelItem {
  return {
    id: `pch-${clientId}`,
    kind: "chat",
    at: new Date().toISOString().slice(0, 19) + "Z",
    authorKind: "user",
    title: null,
    body,
    reportId: null,
    reviewId: null,
    severity: null,
    suggestedActions: null,
    executionId: null,
    replyTo: null,
    extra: '{"pending":true}',
  };
}

export interface PersonaChannelSlice {
  // State — all keyed by RAW persona id (its own record, so no namespacing
  // collision with team ids is possible).
  personaChannels: Record<string, PersonaChannelState>;
  /** Refcount of live subscribers per persona. Drives what the service polls. */
  personaChannelSubs: Record<string, number>;
  /**
   * Sidebar previews: the newest channel item per persona (null = loaded and
   * empty, absent = never loaded). One `limit:1` read per persona — the
   * sidebar needs "has a channel + newest line" without subscribing every
   * persona to the full poll loop.
   */
  personaChannelPreviews: Record<string, PersonaChannelItem | null>;

  // Actions
  subscribePersonaChannel: (personaId: string) => () => void;
  refreshPersonaChannel: (personaId: string) => Promise<void>;
  refreshSubscribedPersonaChannels: () => Promise<void>;
  /** Refresh ONLY this persona's subscribed channel + its preview — the
   *  PERSONA_CHANNEL_MESSAGE push path. */
  notifyPersonaChannel: (personaId: string) => Promise<void>;
  loadOlderPersonaChannel: (personaId: string) => Promise<void>;
  loadPersonaChannelPreviews: (personaIds: string[]) => Promise<void>;
  sendPersonaChannelMessage: (personaId: string, content: string) => Promise<void>;
  markPersonaChannelSeen: (personaId: string) => void;
}

export const createPersonaChannelSlice: StateCreator<PipelineStore, [], [], PersonaChannelSlice> = (
  set,
  get,
) => ({
  personaChannels: {},
  personaChannelSubs: {},
  personaChannelPreviews: {},

  subscribePersonaChannel: (personaId) => {
    const prior = get().personaChannelSubs[personaId] ?? 0;
    set((s) => ({
      personaChannelSubs: {
        ...s.personaChannelSubs,
        [personaId]: (s.personaChannelSubs[personaId] ?? 0) + 1,
      },
    }));

    if (prior === 0) {
      if (!get().personaChannels[personaId]) {
        set((s) => ({
          personaChannels: {
            ...s.personaChannels,
            [personaId]: { ...EMPTY_PERSONA_CHANNEL, lastSeenAt: readPersonaLastSeen(personaId) },
          },
        }));
      }
      void get().refreshPersonaChannel(personaId);
    }

    let released = false;
    return () => {
      if (released) return; // idempotent — StrictMode double-invokes cleanups
      released = true;
      set((s) => {
        const next = (s.personaChannelSubs[personaId] ?? 1) - 1;
        const subs = { ...s.personaChannelSubs };
        if (next <= 0) delete subs[personaId];
        else subs[personaId] = next;
        return { personaChannelSubs: subs };
      });
    };
  },

  refreshPersonaChannel: async (personaId) => {
    try {
      const head = await listPersonaChannel(personaId, PERSONA_CHANNEL_PAGE);
      set((s) => {
        const prev =
          s.personaChannels[personaId] ??
          { ...EMPTY_PERSONA_CHANNEL, lastSeenAt: readPersonaLastSeen(personaId) };
        const items = mergeHeadBy(prev.items, head, samePersonaItem);
        // A short FIRST page is the whole channel — nothing older exists.
        const exhausted =
          prev.items.length === 0 && head.length < PERSONA_CHANNEL_PAGE ? true : prev.exhausted;
        // The server row with an echo's id has arrived — the echo retires.
        const present = new Set(items.map((i) => i.id));
        const echoes = prev.echoes.filter((e) => !present.has(e.id));
        // Identity-preserving no-op (see channelSlice): a quiet tick writes
        // nothing and no subscriber re-renders.
        if (
          items === prev.items && prev.loaded && exhausted === prev.exhausted &&
          echoes.length === prev.echoes.length
        ) {
          return {};
        }
        return {
          personaChannels: {
            ...s.personaChannels,
            [personaId]: { ...prev, items, loaded: true, exhausted, echoes },
          },
          // The channel head is fresher than any preview read — keep them agreeing.
          personaChannelPreviews: {
            ...s.personaChannelPreviews,
            [personaId]: items[0] ?? null,
          },
        };
      });
    } catch (e) {
      silentCatch("personas/channel:head")(e);
    }
  },

  refreshSubscribedPersonaChannels: async () => {
    const ids = Object.keys(get().personaChannelSubs);
    await Promise.all(ids.map((id) => get().refreshPersonaChannel(id)));
  },

  notifyPersonaChannel: async (personaId) => {
    const tasks: Promise<void>[] = [];
    if (get().personaChannelSubs[personaId]) {
      tasks.push(get().refreshPersonaChannel(personaId));
    } else if (personaId in get().personaChannelPreviews) {
      // Not open, but listed in the sidebar — keep its preview line live.
      tasks.push(get().loadPersonaChannelPreviews([personaId]));
    }
    await Promise.all(tasks);
  },

  loadOlderPersonaChannel: async (personaId) => {
    const state = get().personaChannels[personaId];
    const oldest = state?.items[state.items.length - 1];
    if (!oldest || state?.exhausted) return;
    try {
      // COMPOSITE cursor (at, id) — `at` is second-resolution.
      const older = await listPersonaChannel(personaId, PERSONA_CHANNEL_PAGE, {
        at: oldest.at,
        id: oldest.id,
      });
      set((s) => {
        const prev = s.personaChannels[personaId];
        if (!prev) return {};
        const known = new Set(prev.items.map((i) => i.id));
        return {
          personaChannels: {
            ...s.personaChannels,
            [personaId]: {
              ...prev,
              items: [...prev.items, ...older.filter((i) => !known.has(i.id))],
              exhausted: older.length < PERSONA_CHANNEL_PAGE,
            },
          },
        };
      });
    } catch (e) {
      silentCatch("personas/channel:older")(e);
    }
  },

  loadPersonaChannelPreviews: async (personaIds) => {
    await Promise.all(
      personaIds.map(async (id) => {
        try {
          const head = await listPersonaChannel(id, 1);
          const newest = head[0] ?? null;
          set((s) => {
            const prev = s.personaChannelPreviews[id];
            // No-op write guard: previews refresh on every push event, and
            // most bring nothing new for most personas.
            if (prev !== undefined && (prev === newest || (prev && newest && samePersonaItem(prev, newest)))) {
              return {};
            }
            return {
              personaChannelPreviews: { ...s.personaChannelPreviews, [id]: newest },
            };
          });
        } catch (e) {
          silentCatch("personas/channel:preview")(e);
        }
      }),
    );
  },

  sendPersonaChannelMessage: async (personaId, content) => {
    const text = content.trim();
    if (!text) return;
    const clientId = crypto.randomUUID();
    const echo = makeEcho(clientId, text);
    const patch = (fn: (prev: PersonaChannelState) => Partial<PersonaChannelState>) =>
      set((s) => {
        const prev =
          s.personaChannels[personaId] ??
          { ...EMPTY_PERSONA_CHANNEL, lastSeenAt: readPersonaLastSeen(personaId) };
        return {
          personaChannels: { ...s.personaChannels, [personaId]: { ...prev, ...fn(prev) } },
        };
      });
    // Optimistic echo, instantly. `posting` is advisory (the composer shows a
    // subtle state) — send is never disabled; consecutive sends just queue
    // more echoes.
    patch((prev) => ({ echoes: [echo, ...prev.echoes], posting: true }));
    try {
      await postPersonaChannelMessage(personaId, text, clientId);
      // The head read returns the durable row with the SAME id, retiring the echo.
      await get().refreshPersonaChannel(personaId);
    } catch (e) {
      // Mark the echo failed in place rather than vanishing the user's words.
      patch((prev) => ({
        echoes: prev.echoes.map((x) =>
          x.id === echo.id ? { ...x, extra: '{"failed":true}' } : x,
        ),
      }));
      throw e;
    } finally {
      patch(() => ({ posting: false }));
    }
  },

  markPersonaChannelSeen: (personaId) => {
    const state = get().personaChannels[personaId];
    const newest = state?.items[0]?.at;
    if (!newest || state?.lastSeenAt === newest) return;
    writeLastSeen(personaId, newest);
    set((s) => {
      const prev = s.personaChannels[personaId];
      if (!prev) return {};
      return {
        personaChannels: { ...s.personaChannels, [personaId]: { ...prev, lastSeenAt: newest } },
      };
    });
  },
});
