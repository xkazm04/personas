/**
 * A run's stored output (`getLifecycleRunOutput`: at most the last 16 KiB,
 * `--- stdout ---` then `--- stderr ---`) as the run viewer reads it. Pure.
 *
 * - `null` = nothing was kept (the command did not run, or was stopped at its
 *   timeout); `""` = it ran and printed nothing. The two are different
 *   answers and the viewer says each in its own words.
 * - A text with no section labels is one stdout section, so an output stored
 *   by an older writer still reads.
 * - The first error line is the run's `firstError` where the output still
 *   holds it (the tail may have dropped it), else the first line that reads
 *   like an error, stderr before stdout.
 */
import { matchesQuery } from '@/lib/text/search';

export type OutputSection = 'stdout' | 'stderr';

export interface OutputLine {
  section: OutputSection;
  /** Line number within its section, from 1. */
  n: number;
  text: string;
}

export interface ParsedOutput {
  lines: OutputLine[];
  /** Lines per section. */
  counts: Record<OutputSection, number>;
}

const LABEL: Record<string, OutputSection> = { '--- stdout ---': 'stdout', '--- stderr ---': 'stderr' };

export function parseOutput(text: string): ParsedOutput {
  const lines: OutputLine[] = [];
  const counts: Record<OutputSection, number> = { stdout: 0, stderr: 0 };
  let section: OutputSection = 'stdout';
  // A trailing newline is the end of the last line, not a line of its own.
  const raw = text.replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (!raw) return { lines, counts };
  for (const line of raw.split('\n')) {
    const label = LABEL[line.trim()];
    if (label) {
      section = label;
      continue;
    }
    counts[section] += 1;
    lines.push({ section, n: counts[section], text: line });
  }
  return { lines, counts };
}

const ERRORISH = /\b(error|failed|failure|panicked|exception)\b|✗|✖/i;

/** Index into `lines` of the first error line, or -1. */
export function firstErrorIndex(lines: OutputLine[], firstError: string | null): number {
  const wanted = firstError?.trim();
  if (wanted) {
    const exact = lines.findIndex((l) => l.text.trim() === wanted);
    if (exact >= 0) return exact;
    const within = lines.findIndex((l) => l.text.includes(wanted));
    if (within >= 0) return within;
  }
  const inErr = lines.findIndex((l) => l.section === 'stderr' && ERRORISH.test(l.text));
  return inErr >= 0 ? inErr : lines.findIndex((l) => ERRORISH.test(l.text));
}

/**
 * Indexes into `lines` that hold every term of `query` (the app's one matching
 * policy, `matchesQuery`: case and accents folded); none for a blank query.
 */
export function searchLines(lines: OutputLine[], query: string, locale?: string): number[] {
  if (!query.trim()) return [];
  const out: number[] = [];
  lines.forEach((l, i) => { if (matchesQuery(l.text, query, locale)) out.push(i); });
  return out;
}

/** The next (+1) or previous (-1) match position, wrapping; -1 when there are no matches. */
export function stepMatch(at: number, count: number, dir: 1 | -1): number {
  if (count === 0) return -1;
  if (at < 0) return dir === 1 ? 0 : count - 1;
  return (at + dir + count) % count;
}
