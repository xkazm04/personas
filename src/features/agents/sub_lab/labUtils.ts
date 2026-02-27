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

/** Simple word-level diff between two strings */
export function diffStrings(a: string, b: string): Array<{ type: 'same' | 'added' | 'removed'; text: string }> {
  const wordsA = a.split(/(\s+)/);
  const wordsB = b.split(/(\s+)/);
  const result: Array<{ type: 'same' | 'added' | 'removed'; text: string }> = [];

  let i = 0;
  let j = 0;
  while (i < wordsA.length && j < wordsB.length) {
    if (wordsA[i] === wordsB[j]) {
      result.push({ type: 'same', text: wordsA[i]! });
      i++;
      j++;
    } else {
      result.push({ type: 'removed', text: wordsA[i]! });
      result.push({ type: 'added', text: wordsB[j]! });
      i++;
      j++;
    }
  }
  while (i < wordsA.length) {
    result.push({ type: 'removed', text: wordsA[i]! });
    i++;
  }
  while (j < wordsB.length) {
    result.push({ type: 'added', text: wordsB[j]! });
    j++;
  }
  return result;
}
