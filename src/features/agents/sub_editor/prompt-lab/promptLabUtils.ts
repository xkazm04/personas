import { Shield, Beaker, Archive } from 'lucide-react';
import { parseStructuredPrompt } from '@/lib/personas/promptMigration';

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

/** Extract section summaries from a structured prompt JSON string */
export function getSectionSummary(json: string | null): Record<string, string> {
  if (!json) return {};
  const parsed = parseStructuredPrompt(json);
  if (!parsed) return {};
  const result: Record<string, string> = {};
  if (parsed.identity) result['Identity'] = parsed.identity.slice(0, 80);
  if (parsed.instructions) result['Instructions'] = parsed.instructions.slice(0, 80);
  if (parsed.toolGuidance) result['Tool Guidance'] = parsed.toolGuidance.slice(0, 80);
  if (parsed.examples) result['Examples'] = parsed.examples.slice(0, 80);
  if (parsed.errorHandling) result['Error Handling'] = parsed.errorHandling.slice(0, 80);
  return result;
}

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
