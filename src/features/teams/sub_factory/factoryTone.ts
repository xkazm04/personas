// The Factory's states in the composition kit's closed vocabulary (Tone x Glyph,
// doctrine 6b). This replaces the INK "blueprint" hexes on the Factory's own
// surfaces (L1 head, L2, L3, L4); the passport wall keeps passportInk.
//
// What the INK hues meant, and what each maps to (Gate 5 decision list):
//   red     off track / critical     -> error
//   amber   at risk / warning        -> warning
//   emerald healthy / met            -> success (healthy rows recede: muted)
//   blue    setup: not configured, waiting on you (an invitation, not a fault)
//                                    -> info, hollow (owner, Gate 5: not the pink human role)
//   teal    KPI proposals, the active tab
//                                    -> agent (a scan proposed them); the tab is primary
//   violet  agent actions (scan features, forge a crew)
//                                    -> agent
//   slate   unmeasured               -> neutral, hollow
import type { Glyph, Tone } from '@/features/shared/components/kit';
import type { KpiStatus } from './factoryModel';

export interface ToneGlyph { tone: Tone; glyph: Glyph }

/** A KPI's calibrated band. Met and on track are both good; met is drawn solid. */
export const KPI_STATUS_MARK: Record<KpiStatus, ToneGlyph> = {
  met: { tone: 'success', glyph: 'solid' },
  ok: { tone: 'success', glyph: 'soft' },
  warn: { tone: 'warning', glyph: 'solid' },
  crit: { tone: 'error', glyph: 'solid' },
  unmeasured: { tone: 'neutral', glyph: 'hollow' },
};

/** A 0-100 rollup. `null` = nothing measured here yet: neutral, never error. */
export function healthMark(v: number | null): ToneGlyph {
  if (v == null) return { tone: 'neutral', glyph: 'hollow' };
  return v >= 70 ? { tone: 'success', glyph: 'soft' } : v >= 40 ? { tone: 'warning', glyph: 'solid' } : { tone: 'error', glyph: 'solid' };
}

/** A context's worst dimension on the L2 Overview. */
export type FocusKind = 'crit' | 'warn' | 'setup' | 'ok';
export const FOCUS_MARK: Record<FocusKind, ToneGlyph> = {
  crit: { tone: 'error', glyph: 'solid' },
  warn: { tone: 'warning', glyph: 'solid' },
  setup: { tone: 'info', glyph: 'hollow' },
  ok: { tone: 'success', glyph: 'soft' },
};

/** One measured dimension of a context (errors, cost, KPI attainment). */
export type DimTone = 'crit' | 'warn' | 'ok' | 'unmeasured';
export const DIM_TONE: Record<DimTone, Tone> = { crit: 'error', warn: 'warning', ok: 'success', unmeasured: 'neutral' };

/**
 * A 1-2-5 quantum so `value` draws in at most `maxUnits` units (never below
 * `floor`). The same rule Observability states in its legends; proposed for the
 * kit next to `apportion` (Gate 5 kit gaps).
 */
export function unitQuantum(value: number, maxUnits: number, floor: number): number {
  const raw = Math.max(floor, value / maxUnits);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((m) => m * mag >= raw) ?? 10;
  return step * mag;
}
