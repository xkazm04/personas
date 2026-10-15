import { dur } from '../words';
import { WAIT_BINS, waitBins } from './detail';

/** Where a bin's edges are written: "<2s", "2s-5s", "15m+", in the app's duration format. */
function binLabel([a, b]: readonly [number, number]): string {
  if (a === 0) return `<${dur(b)}`;
  if (!Number.isFinite(b)) return `${dur(a)}+`;
  return `${dur(a)}–${dur(b)}`;
}

/** The waits before a settlement, binned; the bin holding the median is the bright one. */
export function WaitHistogram({ waits, median }: { waits: readonly number[]; median: number }) {
  const counts = waitBins(waits);
  const max = Math.max(1, ...counts);
  const bw = 700 / counts.length;
  return (
    <figure className="m-0">
      <svg className="ws-hist" viewBox="0 0 700 110" preserveAspectRatio="none" aria-hidden="true">
        {counts.map((c, i) => {
          const [a, b] = WAIT_BINS[i]!;
          const h = (100 * c) / max;
          return <rect key={i} className={median >= a && median < b ? 'is-med' : undefined} x={i * bw + 6} y={106 - h} width={bw - 12} height={Math.max(1, h)} rx={3} />;
        })}
      </svg>
      <figcaption className="ws-hist-axis typo-caption" style={{ gridTemplateColumns: `repeat(${counts.length}, 1fr)` }}>
        {counts.map((c, i) => <span key={i}><b>{c}</b>{binLabel(WAIT_BINS[i]!)}</span>)}
      </figcaption>
    </figure>
  );
}
