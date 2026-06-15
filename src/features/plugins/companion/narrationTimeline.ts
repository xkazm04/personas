/**
 * Narration timeline — the turn-scoped log of what Athena did while a
 * turn streamed: her own `PROGRESS:` beats plus every tool call (with
 * start/finish times). The live view renders it under the streaming
 * bubble as a dimmed activity log; on `finished` the store promotes it
 * to `narrationByEpisodeId` so a collapsed "What I did — N steps · 48s"
 * trail persists under the completed bubble (same session-scoped model
 * as the recall strip / operational thread).
 *
 * Pure data + helpers only — store wiring lives in `companionStore.ts`,
 * rendering in `NarrationTimeline.tsx`.
 */

export interface NarrationEntry {
  /** `tool_use` block id for tools; a synthetic id for beats. */
  id: string;
  kind: 'beat' | 'tool';
  /** Athena's own words (kind === 'beat'). */
  text?: string;
  /** Tool name + curated input detail (kind === 'tool'). */
  toolName?: string;
  detail?: string;
  /** Epoch ms the entry started. */
  at: number;
  /** Epoch ms the tool's `tool_result` arrived (tools only). */
  endedAt?: number;
}

/** A completed turn's trail, promoted onto an assistant episode. */
export interface StoredNarration {
  startedAt: number;
  endedAt: number;
  entries: NarrationEntry[];
}

/**
 * Append an entry, deduping by id — the CLI can re-emit a `tool_use`
 * block (whole-message after deltas), and a beat re-scan must not
 * double-log.
 */
export function appendNarrationEntry(
  entries: NarrationEntry[],
  entry: NarrationEntry,
): NarrationEntry[] {
  if (entries.some((e) => e.id === entry.id)) return entries;
  return [...entries, entry];
}

/** Stamp a tool entry's end time when its `tool_result` lands. */
export function completeNarrationTool(
  entries: NarrationEntry[],
  id: string,
  endedAt: number,
): NarrationEntry[] {
  const idx = entries.findIndex((e) => e.id === id && e.kind === 'tool');
  if (idx === -1 || entries[idx]!.endedAt != null) return entries;
  const next = entries.slice();
  next[idx] = { ...next[idx]!, endedAt };
  return next;
}

/**
 * Is this trail worth pinning under the completed bubble? The trail now
 * shows only TOOL calls (beats persist as their own aside messages — Phase
 * A/B), so it's worth keeping iff there's at least one tool call. A pure
 * conversational turn (beats only, no tools) has no trail — its beats are
 * already visible as messages.
 */
export function isTrailWorthKeeping(entries: NarrationEntry[]): boolean {
  return entries.some((e) => e.kind === 'tool');
}
