// Beyond the lanes: the finish line. The autopilot chain as one inline step
// indicator — collect → visual pass → stewards → ready — a mark and a word per
// step, joined by hairlines. A failed chain marks the step its reason names
// (or none) and ends in one "Stopped" marker with the retries beside it; the
// reason keeps its line breaks.
import { Check, Circle, CircleDot, MinusCircle, RotateCcw, XCircle } from 'lucide-react';

import { runContestStep } from '@/api/contest';
import { AsyncButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { ContestDetail } from '@/lib/bindings/ContestDetail';
import { toastCatch } from '@/lib/silentCatch';

import { stepLabel } from '../model/labels';
import { chainStations, retrySteps, type StationStatus } from './arenaModel';

const STATION_ICON: Record<StationStatus, typeof Check> = {
  done: Check,
  active: CircleDot,
  pending: Circle,
  skipped: MinusCircle,
  failed: XCircle,
};

const STATION_TONE: Record<StationStatus, string> = {
  done: 'text-status-success',
  active: 'text-status-processing',
  pending: '',
  skipped: '',
  failed: 'text-status-error',
};

export function FinishLine({ detail }: { detail: ContestDetail }) {
  const { t, tx } = useTranslation();
  const s = t.plugins.contest;
  const a = s.arena;
  const { projectId, contestId, phase } = detail.summary;
  const stations = chainStations(detail.chain, detail.judgesEnabled, phase);
  const stopped = detail.chain.step === 'failed';

  return (
    <section className="space-y-1.5" aria-label={a.finish_line} data-testid="arena-finish-line">
      <h4 className="typo-label">{a.finish_line}</h4>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        {stations.map((st, i) => {
          const Icon = STATION_ICON[st.status];
          return (
            <li key={st.id} className="flex items-center gap-2" data-testid={`arena-station-${st.id}`} data-status={st.status}>
              {i > 0 && <span className="h-px w-6 bg-primary/15" aria-hidden />}
              <span className={`inline-flex items-center gap-1.5 typo-caption ${STATION_TONE[st.status]}`}>
                <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden />
                <span className={st.status === 'done' || st.status === 'active' ? 'text-foreground' : ''}>{a.station[st.id]}</span>
                <span className="sr-only">{a.station_status[st.status]}</span>
              </span>
            </li>
          );
        })}
        {stopped && (
          <li className="flex items-center gap-2" data-testid="arena-chain-stopped">
            <span className="h-px w-6 bg-primary/15" aria-hidden />
            <span className="inline-flex items-center gap-1.5 typo-caption text-status-error">
              <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {a.chain_stopped}
            </span>
            {retrySteps(detail).map((step) => (
              <AsyncButton
                key={step}
                size="xs"
                variant="ghost"
                className="typo-caption"
                icon={<RotateCcw className="w-3 h-3" />}
                onClick={() => runContestStep(projectId, contestId, step).catch(toastCatch('contest:arena-retry-step'))}
                data-testid={`arena-retry-${step}`}
              >
                {tx(a.retry, { step: stepLabel(s, step) })}
              </AsyncButton>
            ))}
          </li>
        )}
      </ol>
      {detail.chain.reason && (
        <p className="typo-caption whitespace-pre-wrap break-words" data-testid="arena-chain-reason">
          {detail.chain.reason}
        </p>
      )}
    </section>
  );
}
