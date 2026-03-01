import { Shield, Beaker, Archive } from 'lucide-react';
import { getSectionSummary } from '@/lib/personas/promptMigration';

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

type DiffEntry = { type: 'same' | 'added' | 'removed'; text: string };

/** Max DP cells before falling back to a cheaper diff strategy. */
const MAX_DP_CELLS = 250_000;

/**
 * Run LCS backtrack on two token arrays, returning diff entries.
 * Caller must ensure `aTokens.length * bTokens.length <= MAX_DP_CELLS`.
 */
function lcsDiff(aTokens: string[], bTokens: string[]): DiffEntry[] {
  const m = aTokens.length;
  const n = bTokens.length;

  if (m === 0) return bTokens.map((t) => ({ type: 'added' as const, text: t }));
  if (n === 0) return aTokens.map((t) => ({ type: 'removed' as const, text: t }));

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] = aTokens[i - 1] === bTokens[j - 1]
        ? dp[i - 1]![j - 1]! + 1
        : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
    }
  }

  const parts: DiffEntry[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && aTokens[i - 1] === bTokens[j - 1]) {
      parts.push({ type: 'same', text: aTokens[i - 1]! });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      parts.push({ type: 'added', text: bTokens[j - 1]! });
      j--;
    } else {
      parts.push({ type: 'removed', text: aTokens[i - 1]! });
      i--;
    }
  }
  return parts.reverse();
}

/**
 * Strip matching prefix & suffix from two arrays, run `inner` on the
 * remaining middle, and stitch the three parts back together.
 */
function diffWithStrip(
  tokensA: string[],
  tokensB: string[],
  inner: (midA: string[], midB: string[]) => DiffEntry[],
): DiffEntry[] {
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
  result.push(...inner(tokensA.slice(prefix, suffixA + 1), tokensB.slice(prefix, suffixB + 1)));
  for (let k = suffixA + 1; k < tokensA.length; k++) result.push({ type: 'same', text: tokensA[k]! });
  return result;
}

/** Line-level diff fallback for large prompts. */
function diffByLines(a: string, b: string): DiffEntry[] {
  const linesA = a.split('\n');
  const linesB = b.split('\n');

  return diffWithStrip(linesA, linesB, (midA, midB) => {
    const m = midA.length;
    const n = midB.length;

    // If even line-level is too large, show all-removed + all-added
    if (m > 0 && n > 0 && m * n > MAX_DP_CELLS) {
      return [
        ...midA.map((l) => ({ type: 'removed' as const, text: l + '\n' })),
        ...midB.map((l) => ({ type: 'added' as const, text: l + '\n' })),
      ];
    }

    return lcsDiff(midA, midB).map((d) => ({ ...d, text: d.text + '\n' }));
  });
}

/** LCS-based word-level diff between two strings, with size guard. */
export function diffStrings(a: string, b: string): DiffEntry[] {
  const tokensA = a.split(/(\s+)/);
  const tokensB = b.split(/(\s+)/);

  // Quick upper-bound check before any work — if raw token counts are
  // small enough, the stripped middle can only be smaller.
  if (tokensA.length * tokensB.length <= MAX_DP_CELLS) {
    return diffWithStrip(tokensA, tokensB, lcsDiff);
  }

  // Strip prefix/suffix and re-check the middle
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
  const midLen = (suffixA - prefix + 1) * (suffixB - prefix + 1);

  // If the stripped middle is small enough, run token-level LCS
  if (midLen <= MAX_DP_CELLS) {
    const result: DiffEntry[] = [];
    for (let k = 0; k < prefix; k++) result.push({ type: 'same', text: tokensA[k]! });
    result.push(...lcsDiff(tokensA.slice(prefix, suffixA + 1), tokensB.slice(prefix, suffixB + 1)));
    for (let k = suffixA + 1; k < tokensA.length; k++) result.push({ type: 'same', text: tokensA[k]! });
    return result;
  }

  // Fall back to line-level diff (completely replaces token-level result)
  return diffByLines(a, b);
}
