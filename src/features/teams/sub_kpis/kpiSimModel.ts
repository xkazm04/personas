// What a simulation suggestion IS, and how one is read out of an idea row.
//
// Extracted from `KpiSimSuggestions` 2026-10-06 so the row, the detail modal and
// the list can all name the same type without importing a component from each
// other. The parse is unchanged.
import type { DevIdea } from '@/lib/bindings/DevIdea';

export type ActionKind = 'adopt_measure_config' | 'adjust_target' | 'retire';

export const ACTION_KINDS: ActionKind[] = ['adopt_measure_config', 'adjust_target', 'retire'];

export interface Suggestion {
  ideaId: string;
  kind: ActionKind;
  kpiId: string;
  rationale: string | null;
  citations: string[];
  /** kind-specific payload - {cmd,parse} | {target_value,target_date} | {} */
  payload: Record<string, unknown>;
}

/**
 * Parse a kpi_sim finding into an actionable suggestion, or null when it is a
 * purely informational finding (no actionable kind / no kpi).
 */
export function parseSuggestion(idea: DevIdea): Suggestion | null {
  if (!idea.evidence) return null;
  let ev: Record<string, unknown>;
  try {
    ev = JSON.parse(idea.evidence) as Record<string, unknown>;
  } catch {
    // A finding whose evidence is not JSON is not actionable. This is the
    // function's documented contract rather than an error, which is why the
    // catch is bindingless and silent (see `parseJson.ts` for the canonical
    // shape).
    return null;
  }
  const kind = ev.kind;
  const kpiId = ev.kpi_id;
  if (typeof kind !== 'string' || !ACTION_KINDS.includes(kind as ActionKind)) return null;
  if (typeof kpiId !== 'string' || !kpiId) return null;
  return {
    ideaId: idea.id,
    kind: kind as ActionKind,
    kpiId,
    rationale: idea.description ?? null,
    citations: Array.isArray(ev.citations)
      ? (ev.citations as unknown[]).filter((c): c is string => typeof c === 'string')
      : [],
    payload: (ev.payload && typeof ev.payload === 'object' ? ev.payload : {}) as Record<string, unknown>,
  };
}
