import { Hint } from '@/features/shared/components/kit';
import type { Counts } from '../../model/types';
import { CONSOLE_COPY, fill } from './copy';
import { StateGlyph } from './StateMark';

const MAX_CELLS = 24;

/**
 * The plan as an instrument: a big mono `decided/total` figure over a strip of
 * fine cells, one cell per direction (filled = decided, hatched = running,
 * hairline = still proposed). What waits on the operator stands apart as its
 * own figure, so it is never read as progress.
 */
export function Meter({ counts }: { counts: Counts }) {
  const total = counts.proposed + counts.decided;
  const running = Math.min(counts.running, counts.decided);
  const scale = total > MAX_CELLS ? MAX_CELLS / total : 1;
  const cells = [
    ...Array<string>(Math.round((counts.decided - running) * scale)).fill('d'),
    ...Array<string>(Math.round(running * scale)).fill('r'),
    ...Array<string>(Math.round(counts.proposed * scale)).fill('p'),
  ];
  const hint = fill(CONSOLE_COPY.meter.hint, { w: counts.waits, p: counts.proposed, d: counts.decided, r: counts.running });
  if (total === 0 && counts.waits === 0) return <span className="sc-meter__empty">{CONSOLE_COPY.meter.empty}</span>;
  return (
    <Hint content={hint}>
      <span className="sc-meter" role="img" aria-label={hint}>
        <span className="sc-meter__fig">
          <span className="sc-hero">{counts.decided}</span>
          <span className="sc-hero sc-hero--of">/{total}</span>
        </span>
        <span className="sc-meter__stack">
          <span className="sc-cells">{cells.map((k, i) => <i key={i} className={`sc-cellm sc-cellm--${k}`} />)}</span>
          <span className="sc-micro">{CONSOLE_COPY.meter.decided}</span>
        </span>
        {counts.waits > 0 && (
          <span className="sc-meter__waits">
            <StateGlyph state="waits" />
            <span className="sc-hero sc-hero--sm">{counts.waits}</span>
            <span className="sc-micro">{CONSOLE_COPY.meter.waits}</span>
          </span>
        )}
      </span>
    </Hint>
  );
}
