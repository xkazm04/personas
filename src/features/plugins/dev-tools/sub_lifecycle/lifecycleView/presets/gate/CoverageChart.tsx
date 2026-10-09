/**
 * Coverage over its runs as an instrument: three faint zones (failing under
 * the amber floor, at risk under green, green above), the two threshold lines
 * labelled at the right edge, the readings as a line with the area under it,
 * each reading a point toned by its zone, the latest larger. The run the
 * page's time cursor is on is ringed (`data-mark`).
 *
 * The points are ONE listbox (`useRunCursor`): hover or keyboard shows a
 * point's peek, a press opens that coverage run in the run viewer. The chart
 * zooms to the band its readings and thresholds live in (`coverageDomain`).
 */
import { useRef } from 'react';

import { AnchoredTooltip } from '@/features/shared/components/display/Tooltip';
import { useElementSize } from '@/hooks/utility/interaction/useElementSize';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleRun } from '@/lib/bindings/LifecycleRun';
import { formatNumeric, formatRelativeTime } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { shortSha } from '../../history/parts/Axis';
import { LT } from '../../system/lcType';
import { coverageDomain, coverageZone, type CoveragePoint } from './coverageModel';
import { CoveragePeek } from './CoveragePeek';
import { useRunCursor } from './useRunCursor';

const HEIGHT = 156;
const PAD_Y = 12;
/** Room at the right for the threshold labels. */
const LABEL_W = 76;
const ZONE_INK = { green: 'text-status-success', amber: 'text-status-warning', red: 'text-status-error' } as const;
const ZONE_WASH = { green: 'text-status-success/8', amber: 'text-status-warning/8', red: 'text-status-error/8' } as const;

interface CoverageChartProps {
  points: CoveragePoint[];
  green: number;
  amber: number;
  markRunId: string | null;
  onOpen: (run: LifecycleRun) => void;
}

export function CoverageChart({ points, green, amber, markRunId, onOpen }: CoverageChartProps) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const measured = useElementSize(host).width;
  const width = measured > 0 ? measured : 480;
  const plotW = Math.max(40, width - LABEL_W);
  const n = points.length;
  const { min, max } = coverageDomain(points.map((p) => p.value), green, amber);
  const x = (i: number) => ((i + 0.5) * plotW) / Math.max(1, n);
  const y = (v: number) => PAD_Y + (1 - (Math.min(max, Math.max(min, v)) - min) / (max - min)) * (HEIGHT - PAD_Y * 2);
  const marked = markRunId ? points.findIndex((p) => p.run.id === markRunId) : -1;
  const cursor = useRunCursor(n, (i) => { if (points[i]) onOpen(points[i]!.run); }, marked >= 0 ? marked : null);
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = n > 1 ? `${line} L ${x(n - 1)} ${HEIGHT - PAD_Y} L ${x(0)} ${HEIGHT - PAD_Y} Z` : '';
  const pct = (v: number) => formatNumeric(v, 'percent', { precision: 0, language });
  const zones = [
    { key: 'green', top: max, bottom: green },
    { key: 'amber', top: green, bottom: amber },
    { key: 'red', top: amber, bottom: min },
  ] as const;
  const peeked = cursor.peekIndex != null ? points[cursor.peekIndex] : undefined;
  return (
    <div
      ref={host}
      {...cursor.listbox}
      aria-label={tx(dl.lcx6_cov_label, { count: n })}
      className="relative w-full rounded-interactive outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
      style={{ height: HEIGHT }}
      data-testid="lc2-coverage-trend"
      data-points={n}
    >
      <svg aria-hidden width={width} height={HEIGHT} className="absolute inset-0 block overflow-visible">
        {zones.map((z) => z.top > z.bottom && (
          <rect key={z.key} x={0} width={plotW} y={y(z.top)} height={Math.max(0, y(z.bottom) - y(z.top))} fill="currentColor" className={ZONE_WASH[z.key]} />
        ))}
        {[{ v: green, ink: ZONE_INK.green, label: tx(dl.lcx6_cov_green, { value: pct(green) }) }, { v: amber, ink: ZONE_INK.amber, label: tx(dl.lcx6_cov_floor, { value: pct(amber) }) }].map((t) => (
          <g key={t.label} className={t.ink}>
            <line x1={0} x2={plotW} y1={y(t.v)} y2={y(t.v)} stroke="currentColor" strokeWidth={1.5} strokeDasharray="5 4" />
            <text x={plotW + 8} y={y(t.v) + 4} fill="currentColor" className={LT.label}>{t.label}</text>
          </g>
        ))}
        {area && <path d={area} fill="currentColor" className="text-primary/10" />}
        {n > 1 && <path d={line} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" className="text-primary/70" />}
        {points.map((p, i) => (
          <circle key={p.run.id} cx={x(i)} cy={y(p.value)} r={i === n - 1 ? 6 : 4} fill="currentColor" className={ZONE_INK[coverageZone(p.value, green, amber)]} />
        ))}
        {marked >= 0 && <circle cx={x(marked)} cy={y(points[marked]!.value)} r={10} fill="none" stroke="currentColor" strokeWidth={2} className="text-primary" data-mark={marked} />}
        {cursor.keyboard && n > 0 && <circle cx={x(cursor.cursor)} cy={y(points[cursor.cursor]!.value)} r={9} fill="none" stroke="currentColor" strokeWidth={1.5} strokeDasharray="3 2" className="text-primary" />}
      </svg>
      <div className="absolute inset-y-0 left-0 grid" style={{ width: plotW, gridTemplateColumns: `repeat(${Math.max(1, n)}, minmax(0, 1fr))` }}>
        {points.map((p, i) => (
          <div
            key={p.run.id}
            {...cursor.option(i)}
            aria-label={tx(dl.lcx6_cov_point, { value: pct(p.value), when: formatRelativeTime(p.run.finishedAt, '', { language }), sha: shortSha(p.run.headSha) })}
            className="cursor-pointer rounded-interactive transition-colors duration-150 hover:bg-primary/8 motion-reduce:transition-none"
            data-point={i}
          />
        ))}
      </div>
      <AnchoredTooltip
        anchor={cursor.anchor}
        content={peeked ? <CoveragePeek point={peeked} green={green} amber={amber} previous={cursor.peekIndex! > 0 ? points[cursor.peekIndex! - 1]! : null} /> : null}
        placement="top"
      />
    </div>
  );
}
