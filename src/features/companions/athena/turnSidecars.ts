/**
 * Turn sidecars — the serialization layer between the session-scoped
 * per-turn side channels (narration trail, TodoWrite plan, dispatcher
 * turn summary, recall preview) and the `companion_turn_sidecar` table.
 *
 * Why this exists: all four layers are parsed FRONTEND-side out of the
 * Claude CLI stream and promoted onto an assistant episode id at the
 * `finished` event. Before persistence they lived only in the Zustand
 * store, so an app restart stripped every older bubble back to bare text
 * and the dev conversation-log export lost the side channels for
 * pre-restart turns.
 *
 * Pure data in → data out: no store imports, no IPC. The write/read
 * side-effects live in `useTurnSidecars.ts`; the render paths
 * (NarrationTrail / OperationalThread / TurnSummaryChip / RecallStrip)
 * are untouched — they already key by episode id, so a hydrated map
 * renders exactly like a live one.
 */

import type { CompanionRecallPreview, CompanionTurnSidecar } from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import type { StoredNarration } from './narrationTimeline';
import type { TodoStep } from './operationalSteps';
import type { StoredTurnSummary } from './companionStore';

/**
 * Cap on narration entries written per turn. A pathological turn (a long
 * agentic run with hundreds of tool calls) must not write an unbounded
 * blob into the user DB. The NEWEST entries are kept — the tail is what a
 * reader wants when a trail is too long to show whole.
 */
export const MAX_PERSISTED_NARRATION_ENTRIES = 100;

/** The four channels for one assistant episode, in their live shapes. */
export interface TurnSidecarPayload {
  narration?: StoredNarration;
  steps?: TodoStep[];
  summary?: StoredTurnSummary;
  recall?: CompanionRecallPreview;
}

/** The store maps a hydration pass fills. */
export interface HydratedSidecars {
  narrationByEpisodeId: Record<string, StoredNarration>;
  stepsByEpisodeId: Record<string, TodoStep[]>;
  turnSummaryByEpisodeId: Record<string, StoredTurnSummary>;
  recallByEpisodeId: Record<string, CompanionRecallPreview>;
}

/** Trim an over-long trail to its newest `MAX_PERSISTED_NARRATION_ENTRIES`. */
export function capNarration(narration: StoredNarration): StoredNarration {
  if (narration.entries.length <= MAX_PERSISTED_NARRATION_ENTRIES) return narration;
  return {
    ...narration,
    entries: narration.entries.slice(-MAX_PERSISTED_NARRATION_ENTRIES),
  };
}

/** The IPC argument shape. Absent fields leave the stored value alone. */
export interface SerializedSidecar {
  episodeId: string;
  narrationJson?: string;
  stepsJson?: string;
  summaryJson?: string;
  recallJson?: string;
}

/**
 * Serialize whatever channels are present. Returns `null` when there is
 * nothing worth a row — a plain conversational turn has no side channels
 * at all and the caller fires unconditionally.
 */
export function serializeSidecar(
  episodeId: string,
  payload: TurnSidecarPayload,
): SerializedSidecar | null {
  if (!episodeId) return null;
  const out: SerializedSidecar = { episodeId };
  let any = false;
  if (payload.narration && payload.narration.entries.length > 0) {
    out.narrationJson = JSON.stringify(capNarration(payload.narration));
    any = true;
  }
  if (payload.steps && payload.steps.length > 0) {
    out.stepsJson = JSON.stringify(payload.steps);
    any = true;
  }
  if (payload.summary) {
    out.summaryJson = JSON.stringify(payload.summary);
    any = true;
  }
  if (payload.recall) {
    out.recallJson = JSON.stringify(payload.recall);
    any = true;
  }
  return any ? out : null;
}

function parseBlob<T>(raw: string | null, what: string): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    // A corrupt blob degrades to "no sidecar" — exactly the behaviour
    // before persistence existed — rather than breaking the transcript.
    silentCatch(`turnSidecars:parse:${what}`)(e);
    return undefined;
  }
}

/** Turn persisted rows back into the four store maps. */
export function parseSidecars(rows: CompanionTurnSidecar[]): HydratedSidecars {
  const out: HydratedSidecars = {
    narrationByEpisodeId: {},
    stepsByEpisodeId: {},
    turnSummaryByEpisodeId: {},
    recallByEpisodeId: {},
  };
  for (const row of rows) {
    if (!row?.episodeId) continue;
    const narration = parseBlob<StoredNarration>(row.narrationJson, 'narration');
    // A trail with no entries would render an empty "What I did" toggle.
    if (narration && Array.isArray(narration.entries) && narration.entries.length > 0) {
      out.narrationByEpisodeId[row.episodeId] = narration;
    }
    const steps = parseBlob<TodoStep[]>(row.stepsJson, 'steps');
    if (Array.isArray(steps) && steps.length > 0) {
      out.stepsByEpisodeId[row.episodeId] = steps;
    }
    const summary = parseBlob<StoredTurnSummary>(row.summaryJson, 'summary');
    if (summary) out.turnSummaryByEpisodeId[row.episodeId] = summary;
    const recall = parseBlob<CompanionRecallPreview>(row.recallJson, 'recall');
    if (recall) out.recallByEpisodeId[row.episodeId] = recall;
  }
  return out;
}

/** True when a hydration pass produced nothing (skip the store write). */
export function isEmptyHydration(h: HydratedSidecars): boolean {
  return (
    Object.keys(h.narrationByEpisodeId).length === 0 &&
    Object.keys(h.stepsByEpisodeId).length === 0 &&
    Object.keys(h.turnSummaryByEpisodeId).length === 0 &&
    Object.keys(h.recallByEpisodeId).length === 0
  );
}
