import { compositeScoreFromRow } from '@/lib/eval/evalFramework';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';

/** One model's averaged sub-scores; `null` is "never scored", not "scored zero". */
export interface ArenaWinnerScore {
  ta: number | null;
  oq: number | null;
  pc: number | null;
  comp: number;
}

/**
 * The best model's averaged sub-scores and composite for one arena run.
 * Each metric is averaged over the rows where it was scored. A metric no row
 * scored stays `null` (sandbox runs omit tool accuracy entirely), so the
 * history column renders it as unscored instead of a worst-on-scale red 0.
 */
export function computeWinnerScore(results: LabArenaResult[] | undefined): ArenaWinnerScore | null {
  if (!results || results.length === 0) return null;
  interface PerModel { taSum: number; taCount: number; oqSum: number; oqCount: number; pcSum: number; pcCount: number; }
  const modelScores = new Map<string, PerModel>();
  for (const r of results) {
    if (!modelScores.has(r.modelId)) modelScores.set(r.modelId, { taSum: 0, taCount: 0, oqSum: 0, oqCount: 0, pcSum: 0, pcCount: 0 });
    const m = modelScores.get(r.modelId)!;
    if (r.toolAccuracyScore != null) { m.taSum += r.toolAccuracyScore; m.taCount++; }
    if (r.outputQualityScore != null) { m.oqSum += r.outputQualityScore; m.oqCount++; }
    if (r.protocolCompliance != null) { m.pcSum += r.protocolCompliance; m.pcCount++; }
  }
  let best: ArenaWinnerScore | null = null;
  for (const [, m] of modelScores) {
    const ta = m.taCount > 0 ? Math.round(m.taSum / m.taCount) : null;
    const oq = m.oqCount > 0 ? Math.round(m.oqSum / m.oqCount) : null;
    const pc = m.pcCount > 0 ? Math.round(m.pcSum / m.pcCount) : null;
    const comp = compositeScoreFromRow(ta, oq, pc);
    if (comp == null) continue;
    if (!best || comp > best.comp) best = { ta, oq, pc, comp };
  }
  return best;
}
