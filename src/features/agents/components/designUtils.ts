import type { DesignAnalysisResult } from '@/lib/types/designTypes';

/** Derive a short agent name from the user's intent. */
export function deriveName(intent: string): string {
  const trimmed = intent.trim();
  if (!trimmed) return 'New Agent';
  const short = trimmed.slice(0, 30);
  const atWord = short.lastIndexOf(' ');
  const base = atWord > 10 ? short.slice(0, atWord) : short;
  return trimmed.length > base.length ? `${base}...` : base;
}

/** Calculate persona completeness based on design result fields. */
export function calcCompleteness(result: DesignAnalysisResult | null): number {
  if (!result) return 0;
  let filled = 0;
  const total = 6;
  if (result.structured_prompt?.identity) filled++;
  if (result.structured_prompt?.instructions) filled++;
  if (result.full_prompt_markdown) filled++;
  if (result.suggested_tools.length > 0) filled++;
  if (result.suggested_triggers.length > 0) filled++;
  if (result.summary) filled++;
  return Math.round((filled / total) * 100);
}
