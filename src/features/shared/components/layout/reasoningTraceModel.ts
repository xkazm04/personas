/**
 * Pure model behind `ReasoningTrace`'s toolbar: which entries a filter chip
 * shows, and how the visible slice serialises to markdown for the clipboard.
 * Kept out of the component so both are unit-testable without a DOM.
 */
import type { ReasoningEntry } from '@/hooks/execution/useReasoningTrace';

/** Toolbar chip identity. 'tools' covers the whole tool/file lane. */
export type TraceFilter = 'all' | 'tools' | 'errors';

const TOOL_TYPES = new Set<ReasoningEntry['type']>(['tool_call', 'tool_result', 'file_change']);

/** The entries a chip shows. 'all' is the identity filter (same array back). */
export function filterTraceEntries(entries: ReasoningEntry[], filter: TraceFilter): ReasoningEntry[] {
  if (filter === 'all') return entries;
  if (filter === 'errors') return entries.filter((e) => e.type === 'error');
  return entries.filter((e) => TOOL_TYPES.has(e.type));
}

/** Seconds since the trace's base moment, as the rows label them. */
function relativeSeconds(ts: number, base: number): number {
  return Math.max(0, Math.round((ts - base) / 1000));
}

/** One markdown line per entry, with the full payload — not the row's truncated preview. */
function lineFor(entry: ReasoningEntry, base: number): string {
  const at = `[${relativeSeconds(entry.ts, base)}s]`;
  switch (entry.type) {
    case 'init':
      return `${at} init ${entry.model}${entry.sessionId ? ` (${entry.sessionId})` : ''}`;
    case 'text':
      return `${at} reasoning: ${entry.content}`;
    case 'tool_call':
      return `${at} tool_call ${entry.toolName}: ${entry.inputPreview}`;
    case 'tool_result':
      return `${at} tool_result: ${entry.contentPreview}`;
    case 'file_change':
      return `${at} ${entry.changeType} ${entry.path}`;
    case 'heartbeat':
      return `${at} heartbeat (silent ${Math.round(entry.silence / 1000)}s)`;
    case 'complete':
      return `${at} complete ${(entry.durationMs / 1000).toFixed(1)}s${entry.cost != null ? ` cost ${entry.cost}` : ''}${entry.tokens != null ? ` ${entry.tokens} tokens` : ''}`;
    case 'error':
      return `${at} error: ${entry.message}`;
  }
}

/**
 * The visible slice as a markdown bullet list. Empty input yields an empty
 * string so `CopyButton` suppresses its success flash rather than claiming to
 * have copied nothing.
 */
export function traceToMarkdown(entries: ReasoningEntry[], base: number): string {
  if (entries.length === 0) return '';
  return entries.map((e) => `- ${lineFor(e, base)}`).join('\n');
}

/** Index of the LAST error entry in the list, or -1. Drives the jump control. */
export function lastErrorIndex(entries: ReasoningEntry[]): number {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]!.type === 'error') return i;
  }
  return -1;
}
