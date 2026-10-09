/**
 * The peek over one coverage run: its reading and the verdict it earns, the
 * change from the run before it, when and on which commit, and how the
 * command itself came out. Inert like every tip; a press opens the run.
 */
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { formatNumeric } from '@/lib/utils/formatters';

import { useLifecycleViewModel } from '../../context';
import { fillTemplate } from '../../frame/fillTemplate';
import { shortSha } from '../../history/parts/Axis';
import { LT } from '../../system/lcType';
import { RunPill, VerdictPill } from '../../system/Pill';
import { coverageZone, type CoveragePoint } from './coverageModel';

export function CoveragePeek({ point, previous, green, amber }: { point: CoveragePoint; previous: CoveragePoint | null; green: number; amber: number }) {
  const { dl, tx } = useLifecycleViewModel();
  const { language } = useTranslation();
  const change = previous ? point.value - previous.value : null;
  const sign = change != null && change > 0 ? '+' : '';
  return (
    <div className="flex w-[20rem] max-w-full flex-col gap-1.5 py-1" data-testid="lc6-coverage-peek" data-run={point.run.id}>
      <div className="flex items-center justify-between gap-3">
        <span className={LT.title}>{dl.lcx6_cov_peek_title}</span>
        <VerdictPill health={coverageZone(point.value, green, amber)} />
      </div>
      <div className="flex items-baseline gap-2">
        <span className={LT.stat}>{formatNumeric(point.value, 'percent', { precision: 0, language })}</span>
        {change != null && change !== 0 && (
          <span className={`${LT.delta} ${change > 0 ? 'text-status-success' : 'text-status-error'}`}>
            {tx(dl.lcx2_delta_pts, { value: `${sign}${formatNumeric(change, 'plain', { precision: 0, language })}` })}
          </span>
        )}
      </div>
      <span className={LT.meta}>
        {fillTemplate(dl.lcx1_fresh_measured, {
          time: <RelativeTime timestamp={point.run.finishedAt} showTooltip={false} />,
          sha: <span className={LT.code}>{shortSha(point.run.headSha)}</span>,
        })}
      </span>
      <span className="flex items-center gap-2">
        <RunPill outcome={point.run.outcome} />
        <span className={LT.metaNum}>{formatNumeric(point.run.durationMs, 'ms')}</span>
      </span>
      <p className={LT.meta}>{dl.lcx6_peek_open}</p>
    </div>
  );
}
