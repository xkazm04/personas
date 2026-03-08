import type { PromptPerformancePoint } from '@/lib/bindings/PromptPerformancePoint';

export interface ComparedPoint extends PromptPerformancePoint {
  costA: number | null;
  costB: number | null;
  latencyA: number | null;
  latencyB: number | null;
  errorA: number | null;
  errorB: number | null;
}

export interface DeltaPoint {
  date: string;
  costDeltaPct: number | null;
  latencyDeltaPct: number | null;
  errorDeltaPct: number | null;
}

export function toDeltaPercent(a: number | null, b: number | null): number | null {
  if (a == null || b == null || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

export function buildDeltaSeries(comparedData: ComparedPoint[] | null): DeltaPoint[] {
  return comparedData?.map((p) => ({
    date: p.date,
    costDeltaPct: toDeltaPercent(p.costA, p.costB),
    latencyDeltaPct: toDeltaPercent(p.latencyA, p.latencyB),
    errorDeltaPct: toDeltaPercent(p.errorA, p.errorB),
  })) ?? [];
}

export function deltaCellClass(delta: number | null): string {
  if (delta == null) return 'bg-secondary/20 text-muted-foreground/40 border-primary/10';
  if (delta <= -15) return 'bg-emerald-500/30 text-emerald-200 border-emerald-500/40';
  if (delta < 0) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30';
  if (delta < 15) return 'bg-amber-500/20 text-amber-300 border-amber-500/30';
  return 'bg-red-500/25 text-red-200 border-red-500/35';
}

export function fmtDelta(v: number | null): string {
  return v == null ? '\u2014' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
}
