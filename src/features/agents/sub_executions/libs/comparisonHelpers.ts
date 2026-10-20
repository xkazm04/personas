import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { formatCost } from '@/lib/utils/formatters';
import type { ToolCallStep } from '@/lib/bindings/ToolCallStep';
import { parseToolSteps } from '@/hooks/execution/useReplayTimeline';

export type { ToolCallStep };

// Re-exported, not re-implemented: this was a byte-identical copy of the
// replay hook's `parseToolSteps` (the one under test), as `trace/stageColors.ts`
// had been before it switched to the same re-export.
export { parseToolSteps };

export function pctChange(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100;
  return ((b - a) / a) * 100;
}

export function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(0)}%`;
}

export function fmtTokens(n: number, opts?: { withMillions?: boolean }): string {
  if (opts?.withMillions && n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}${opts?.withMillions ? 'K' : 'k'}`;
  return String(n);
}

/**
 * USD cost for the comparison / bulk-rerun surfaces.
 *
 * A thin delegate to the app's `formatCost`, kept only for the shorter default
 * (4 decimals) these surfaces want. It used to be a private reimplementation
 * that hardcoded `$` — so every one of these numbers stayed `$0.0042` in a
 * fr-FR session while the rest of the app read `0,0042 $` — and returned
 * `'<$0.001'` for an EXACT zero, which claims a small nonzero cost for a run
 * that cost nothing (a local model, where `estimateCost` returns 0). Zero is
 * exactly representable; `<` means "too small to show at this precision".
 * `formatCost` has known both of those since `formatters.ts:198`.
 */
export function fmtCost(v: number | null | undefined, opts?: { precision?: 4 | 'auto' }): string {
  return formatCost(v, { precision: opts?.precision ?? 4 });
}

export function deltaColor(pct: number, lowerIsBetter = true): string {
  if (Math.abs(pct) < 5) return 'text-foreground';
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return good ? 'text-emerald-400' : 'text-amber-400';
}

/**
 * `diffLines` and `jsonDiff` USED TO LIVE HERE and now live in
 * [`comparisonDiffCore.ts`](./comparisonDiffCore.ts). They are not re-exported
 * from this file on purpose.
 *
 * This module imports `formatCost`, and therefore the i18n store, the
 * translation loader and lucide. The comparison Web Worker needs only
 * `jsonDiff` — but Vite builds workers as IIFE, which inlines dynamic imports,
 * so that one import pulled all 14 locale catalogs into the worker chunk:
 * 23.3 MB, 39.8% of dist's JS, in every installer (measured 2026-09-20 at
 * `bb8e2ecdf`). A convenience re-export here would let the next caller walk
 * straight back into it, so the import has to name the pure module.
 */

/**
 * One line of the "what changed" summary as a typed token. The helper stays
 * language-free (it is a `.ts` module the JSX lint cannot see); the component
 * renders each token through `t.agents.executions.what_changed_<kind>`.
 * `retry` is the right run's retry count (0 = the original run); status and
 * model values are raw machine tokens the renderer maps to display labels.
 */
export type WhatChangedKind =
  | 'tokens_fewer' | 'tokens_more' | 'cost_less' | 'cost_more'
  | 'slower' | 'faster' | 'status' | 'tool_order' | 'tool_calls' | 'model' | 'none';

export interface WhatChangedItem {
  kind: WhatChangedKind;
  retry: number;
  vars: Record<string, string | number>;
}

/** Generate "what changed" tokens between two executions. */
export function generateWhatChanged(left: PersonaExecution, right: PersonaExecution): WhatChangedItem[] {
  const changes: WhatChangedItem[] = [];
  const retry = right.retry_count > 0 ? right.retry_count : 0;
  const push = (kind: WhatChangedKind, vars: Record<string, string | number> = {}) =>
    changes.push({ kind, retry, vars });

  const totalLeft = left.input_tokens + left.output_tokens;
  const totalRight = right.input_tokens + right.output_tokens;
  if (totalLeft > 0 && totalRight > 0) {
    const tokenPct = pctChange(totalLeft, totalRight);
    if (Math.abs(tokenPct) >= 10) {
      push(tokenPct < 0 ? 'tokens_fewer' : 'tokens_more', { pct: Math.abs(tokenPct).toFixed(0) });
    }
  }

  // Both sides must HAVE a cost: comparing a recorded cost against an
  // unrecorded one as if the latter were $0 reports a percentage that is not
  // a fact about either run.
  if (left.cost_usd != null && right.cost_usd != null && left.cost_usd > 0 && right.cost_usd > 0) {
    const costPct = pctChange(left.cost_usd, right.cost_usd);
    if (Math.abs(costPct) >= 10) {
      push(costPct < 0 ? 'cost_less' : 'cost_more', { pct: Math.abs(costPct).toFixed(0) });
    }
  }

  const durL = left.duration_ms ?? 0;
  const durR = right.duration_ms ?? 0;
  if (durL > 0 && durR > 0) {
    const durPct = pctChange(durL, durR);
    if (Math.abs(durPct) >= 20) {
      const ratio = durR / durL;
      push(durPct > 0 ? 'slower' : 'faster', { ratio: (durPct > 0 ? ratio : 1 / ratio).toFixed(1) });
    }
  }

  if (left.status !== right.status) {
    push('status', { from: left.status, to: right.status });
  }

  const stepsL = parseToolSteps(left.tool_steps);
  const stepsR = parseToolSteps(right.tool_steps);
  const orderL = stepsL.map(s => s.tool_name).join(',');
  const orderR = stepsR.map(s => s.tool_name).join(',');
  if (orderL && orderR && orderL !== orderR) {
    push('tool_order');
  }
  if (stepsL.length !== stepsR.length && (stepsL.length > 0 || stepsR.length > 0)) {
    push('tool_calls', { from: stepsL.length, to: stepsR.length });
  }

  if (left.model_used && right.model_used && left.model_used !== right.model_used) {
    push('model', { from: left.model_used, to: right.model_used });
  }

  if (changes.length === 0) {
    push('none');
  }

  return changes;
}
