import { Shield, Beaker, Archive } from 'lucide-react';
import { getSectionSummary } from '@/lib/personas/promptMigration';

// ── Scoring utilities — delegated to unified eval framework ──
// These are re-exported from the single source of truth.
export {
  compositeScore,
  scoreColor,
  statusBadge,
  WEIGHT_TOOL_ACCURACY,
  WEIGHT_OUTPUT_QUALITY,
  WEIGHT_PROTOCOL_COMPLIANCE,
} from '@/lib/eval/evalFramework';

// ── Tag colors ──
export const TAG_STYLES: Record<string, { bg: string; text: string; icon: typeof Shield }> = {
  production: { bg: 'bg-emerald-500/15 border-emerald-500/20', text: 'text-emerald-400', icon: Shield },
  experimental: { bg: 'bg-amber-500/15 border-amber-500/20', text: 'text-amber-400', icon: Beaker },
  archived: { bg: 'bg-zinc-500/15 border-zinc-500/20', text: 'text-zinc-400', icon: Archive },
};

// ── Helpers ──

export function formatRelative(dateStr: string): string {
  const d = new Date(dateStr);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString();
}

// getSectionSummary is re-exported from the canonical StructuredPrompt module
export { getSectionSummary };

/** LCS-based word-level diff between two strings */
export function diffStrings(a: string, b: string): Array<{ type: 'same' | 'added' | 'removed'; text: string }> {
  type DiffEntry = { type: 'same' | 'added' | 'removed'; text: string };
  const tokensA = a.split(/(\s+)/);
  const tokensB = b.split(/(\s+)/);

  // Strip common prefix/suffix to reduce DP table size
  let prefix = 0;
  while (prefix < tokensA.length && prefix < tokensB.length && tokensA[prefix] === tokensB[prefix]) {
    prefix++;
  }
  let suffixA = tokensA.length - 1;
  let suffixB = tokensB.length - 1;
  while (suffixA >= prefix && suffixB >= prefix && tokensA[suffixA] === tokensB[suffixB]) {
    suffixA--;
    suffixB--;
  }

  const result: DiffEntry[] = [];
  for (let k = 0; k < prefix; k++) result.push({ type: 'same', text: tokensA[k]! });

  const midA = tokensA.slice(prefix, suffixA + 1);
  const midB = tokensB.slice(prefix, suffixB + 1);
  const m = midA.length;
  const n = midB.length;

  if (m === 0) {
    for (const t of midB) result.push({ type: 'added', text: t });
  } else if (n === 0) {
    for (const t of midA) result.push({ type: 'removed', text: t });
  } else {
    // LCS dynamic programming
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i]![j] = midA[i - 1] === midB[j - 1]
          ? dp[i - 1]![j - 1]! + 1
          : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
    // Backtrack to produce diff
    const parts: DiffEntry[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && midA[i - 1] === midB[j - 1]) {
        parts.push({ type: 'same', text: midA[i - 1]! });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
        parts.push({ type: 'added', text: midB[j - 1]! });
        j--;
      } else {
        parts.push({ type: 'removed', text: midA[i - 1]! });
        i--;
      }
    }
    result.push(...parts.reverse());
  }

  for (let k = suffixA + 1; k < tokensA.length; k++) result.push({ type: 'same', text: tokensA[k]! });
  return result;
}
