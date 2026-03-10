export interface ToolCallStep {
  step_index: number;
  tool_name: string;
  input_preview: string;
  output_preview: string;
  started_at_ms: number;
  ended_at_ms?: number;
  duration_ms?: number;
}

export function parseToolSteps(raw: string | null): ToolCallStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { // intentional: non-critical — JSON parse fallback
    return [];
  }
}

export function durationColor(ms: number | undefined): string {
  if (ms === undefined) return 'bg-secondary/60 text-muted-foreground/80 border-primary/15';
  if (ms < 2000) return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20';
  if (ms < 10000) return 'bg-amber-500/15 text-amber-400 border-amber-500/20';
  return 'bg-red-500/15 text-red-400 border-red-500/20';
}

export function formatCost(value: number): string {
  if (value < 0.001) return '<$0.001';
  return `$${value.toFixed(4)}`;
}

export function formatTimeGap(ms: number): string {
  if (ms < 1000) return `+${Math.round(ms)}ms`;
  if (ms < 60000) return `+${(ms / 1000).toFixed(1)}s`;
  return `+${(ms / 60000).toFixed(1)}m`;
}
