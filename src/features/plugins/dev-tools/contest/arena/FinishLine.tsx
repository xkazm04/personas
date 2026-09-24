// Beyond the lanes: the finish-line strip. The autopilot chain as four
// stations — collect → visual pass → stewards → ready — each done, in
// progress, waiting, skipped or stopped. A stopped chain offers a retry per
// step (the sidecar does not record which step failed).
import { Check, Circle, CircleDot, Flag, MinusCircle, RotateCcw, XCircle } from 'lucide-react';

import { runContestStep } from '@/api/contest';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import { toastCatch } from '@/lib/silentCatch';

import { retrySteps } from '../components/RunBoard';
import { stepLabel } from '../model/labels';
import { chainStations, type StationStatus } from './arenaModel';
import { ARENA, STATION_LABEL, STATION_STATUS } from './copy';

const STATION_ICON: Record<StationStatus, typeof Check> = {
  done: Check,
  active: CircleDot,
  pending: Circle,
  skipped: MinusCircle,
  failed: XCircle,
};

const STATION_TONE: Record<StationStatus, string> = {
  done: 'text-status-success border-status-success/40',
  active: 'text-status-processing border-status-processing/40',
  pending: 'text-foreground border-primary/12',
  skipped: 'text-foreground border-primary/10 border-dashed',
  failed: 'text-status-error border-status-error/40',
};

export function FinishLine({ detail }: { detail: ContestDetail }) {
  const { t } = useTranslation();
  const s = t.plugins.contest;
  const { projectId, contestId, phase } = detail.summary;
  const stations = chainStations(detail.chain, detail.judgesEnabled, phase);
  const failed = detail.chain.step === 'failed';

  return (
    <section className="space-y-2" aria-label={ARENA.finishLine} data-testid="arena-finish-line">
      <div className="flex items-center gap-2">
        <Flag className="w-4 h-4 text-primary" aria-hidden />
        <h4 className="typo-heading">{ARENA.finishLine}</h4>
      </div>
      <ol className="flex flex-wrap items-stretch gap-1.5">
        {stations.map((st, i) => {
          const Icon = STATION_ICON[st.status];
          return (
            <li key={st.id} className="flex items-center gap-1.5" data-testid={`arena-station-${st.id}`} data-status={st.status}>
              {i > 0 && <span className="h-px w-4 border-t border-dashed border-primary/20" aria-hidden />}
              <span className={`inline-flex items-center gap-1.5 rounded-interactive border px-2.5 py-1 ${STATION_TONE[st.status]}`}>
                <Icon className="w-3.5 h-3.5" aria-hidden />
                <span className="typo-caption">{STATION_LABEL[st.id]}</span>
                <span className="sr-only">{STATION_STATUS[st.status]}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {detail.chain.reason && <p className="typo-caption text-foreground">{detail.chain.reason}</p>}
      {failed && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="typo-caption text-status-error">{ARENA.finishFailed}</span>
          {retrySteps(detail).map((st) => (
            <AsyncButton
              key={st}
              size="xs"
              variant="secondary"
              icon={<RotateCcw className="w-3 h-3" />}
              onClick={() => runContestStep(projectId, contestId, st).catch(toastCatch('contest:arena-retry-step'))}
              data-testid={`arena-retry-${st}`}
            >
              {ARENA.retry(stepLabel(s, st))}
            </AsyncButton>
          ))}
        </div>
      )}
    </section>
  );
}
