import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

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
  } catch { // intentional: non-critical -- JSON parse fallback
    return [];
  }
}

export function pctChange(a: number, b: number): number {
  if (a === 0) return b === 0 ? 0 : 100;
  return ((b - a) / a) * 100;
}

export function fmtPct(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(0)}%`;
}

export function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function fmtCost(v: number): string {
  return v < 0.001 ? '<$0.001' : `$${v.toFixed(4)}`;
}

export function deltaColor(pct: number, lowerIsBetter = true): string {
  if (Math.abs(pct) < 5) return 'text-muted-foreground/70';
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return good ? 'text-emerald-400' : 'text-amber-400';
}

/** Simple word-level diff for terminal output lines. */
export function diffLines(linesA: string[], linesB: string[]): Array<{ type: 'same' | 'added' | 'removed'; text: string }> {
  const result: Array<{ type: 'same' | 'added' | 'removed'; text: string }> = [];
  const setA = new Set(linesA);
  const setB = new Set(linesB);

  for (const line of linesA) {
    if (setB.has(line)) {
      result.push({ type: 'same', text: line });
    } else {
      result.push({ type: 'removed', text: line });
    }
  }
  for (const line of linesB) {
    if (!setA.has(line)) {
      result.push({ type: 'added', text: line });
    }
  }
  return result;
}

/** Structural diff of two JSON strings. */
export function jsonDiff(a: string | null, b: string | null): Array<{ path: string; left: string; right: string }> {
  const diffs: Array<{ path: string; left: string; right: string }> = [];
  try {
    const objA = a ? JSON.parse(a) : {};
    const objB = b ? JSON.parse(b) : {};
    const allKeys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
    for (const key of allKeys) {
      const valA = JSON.stringify(objA[key] ?? null);
      const valB = JSON.stringify(objB[key] ?? null);
      if (valA !== valB) {
        diffs.push({ path: key, left: valA, right: valB });
      }
    }
  } catch { // intentional: non-critical -- JSON parse fallback
    if (a !== b) {
      diffs.push({ path: '(root)', left: a ?? '(empty)', right: b ?? '(empty)' });
    }
  }
  return diffs;
}

/** Generate "what changed" summary between two executions. */
export function generateWhatChanged(left: PersonaExecution, right: PersonaExecution): string[] {
  const changes: string[] = [];
  const rightLabel = right.retry_count > 0 ? `retry #${right.retry_count}` : 'original';

  const totalLeft = left.input_tokens + left.output_tokens;
  const totalRight = right.input_tokens + right.output_tokens;
  if (totalLeft > 0 && totalRight > 0) {
    const tokenPct = pctChange(totalLeft, totalRight);
    if (Math.abs(tokenPct) >= 10) {
      changes.push(
        tokenPct < 0
          ? `Right (${rightLabel}) used ${Math.abs(tokenPct).toFixed(0)}% fewer tokens`
          : `Right (${rightLabel}) used ${tokenPct.toFixed(0)}% more tokens`
      );
    }
  }

  if (left.cost_usd > 0 && right.cost_usd > 0) {
    const costPct = pctChange(left.cost_usd, right.cost_usd);
    if (Math.abs(costPct) >= 10) {
      changes.push(
        costPct < 0
          ? `Right (${rightLabel}) cost ${Math.abs(costPct).toFixed(0)}% less`
          : `Right (${rightLabel}) cost ${costPct.toFixed(0)}% more`
      );
    }
  }

  const durL = left.duration_ms ?? 0;
  const durR = right.duration_ms ?? 0;
  if (durL > 0 && durR > 0) {
    const durPct = pctChange(durL, durR);
    if (Math.abs(durPct) >= 20) {
      const ratio = durR / durL;
      changes.push(
        durPct > 0
          ? `Right (${rightLabel}) took ${ratio.toFixed(1)}x longer`
          : `Right (${rightLabel}) was ${(1 / ratio).toFixed(1)}x faster`
      );
    }
  }

  if (left.status !== right.status) {
    changes.push(`Status changed: ${left.status} → ${right.status}`);
  }

  const stepsL = parseToolSteps(left.tool_steps);
  const stepsR = parseToolSteps(right.tool_steps);
  const orderL = stepsL.map(s => s.tool_name).join(',');
  const orderR = stepsR.map(s => s.tool_name).join(',');
  if (orderL && orderR && orderL !== orderR) {
    changes.push('Different tool call order');
  }
  if (stepsL.length !== stepsR.length && (stepsL.length > 0 || stepsR.length > 0)) {
    changes.push(`Tool calls: ${stepsL.length} → ${stepsR.length}`);
  }

  if (left.model_used && right.model_used && left.model_used !== right.model_used) {
    changes.push(`Model changed: ${left.model_used} → ${right.model_used}`);
  }

  if (changes.length === 0) {
    changes.push('No significant differences detected');
  }

  return changes;
}
