/**
 * A run's output as lines, each section under its own sticky label (stdout,
 * then stderr) with its line count, a line-number gutter per section, the
 * first error line marked in the error ink, and every search match washed with
 * the current one ringed. Plain DOM: a 16 KiB tail is a few hundred lines,
 * which renders at once without a virtual list.
 */
import { memo, type ReactNode } from 'react';

import { useLifecycleViewModel } from '../../context';
import { LT } from '../../system/lcType';
import type { OutputLine, OutputSection, ParsedOutput } from './outputModel';

const SECTIONS: OutputSection[] = ['stdout', 'stderr'];

/** The earliest occurrence at or after `from` of any term, case-insensitively. */
function nextHit(lower: string, terms: string[], from: number): { at: number; len: number } | null {
  let best: { at: number; len: number } | null = null;
  for (const t of terms) {
    const at = lower.indexOf(t, from);
    if (at >= 0 && (!best || at < best.at)) best = { at, len: t.length };
  }
  return best;
}

/**
 * The line's text with each occurrence of a query term washed. A highlight
 * only: whether the line matches is `searchLines`' answer (folded for case
 * and accents), so an accented hit is still counted where it is not washed.
 */
function marked(text: string, query: string): ReactNode {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return text || ' ';
  const parts: ReactNode[] = [];
  const lower = text.toLowerCase();
  let at = 0;
  for (let hit = nextHit(lower, terms, 0); hit; hit = nextHit(lower, terms, at)) {
    if (hit.at > at) parts.push(text.slice(at, hit.at));
    parts.push(<mark key={hit.at} className="rounded-interactive bg-status-warning/35 text-foreground">{text.slice(hit.at, hit.at + hit.len)}</mark>);
    at = hit.at + hit.len;
  }
  parts.push(text.slice(at));
  return parts;
}

interface OutputLinesProps {
  parsed: ParsedOutput;
  errorAt: number;
  query: string;
  matches: ReadonlySet<number>;
  current: number;
}

export const OutputLines = memo(function OutputLines({ parsed, errorAt, query, matches, current }: OutputLinesProps) {
  const { dl, tx } = useLifecycleViewModel();
  const bySection = (s: OutputSection) => parsed.lines.map((l, i) => [l, i] as [OutputLine, number]).filter(([l]) => l.section === s);
  return (
    <div className={LT.code} data-testid="lc6-output-lines">
      {SECTIONS.map((s) => (
        <section key={s} data-section={s} aria-label={s}>
          <header className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-primary/15 bg-secondary px-3 py-1">
            <span className={LT.label}>{s}</span>
            <span className={LT.metaNum}>{parsed.counts[s] ? tx(dl.lcx6_section_lines, { count: parsed.counts[s] }) : dl.lcx6_section_empty}</span>
          </header>
          {bySection(s).map(([line, i]) => {
            const isError = i === errorAt;
            const isCurrent = i === current;
            const tone = isCurrent
              ? 'bg-primary/20 ring-2 ring-inset ring-primary/70'
              : isError ? 'bg-status-error/10' : matches.has(i) ? 'bg-primary/8' : '';
            return (
              <div
                key={i}
                data-line={i}
                data-error={isError || undefined}
                data-current={isCurrent || undefined}
                className={`grid grid-cols-[3.5rem_minmax(0,1fr)] border-l-2 ${isError ? 'border-status-error' : 'border-transparent'} ${tone}`}
              >
                <span aria-hidden className={`select-none pr-3 text-right ${LT.metaNum}`}>{line.n}</span>
                <span className={`whitespace-pre-wrap break-all pr-3 ${isError ? 'text-status-error' : ''}`}>{marked(line.text, query)}</span>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
});
