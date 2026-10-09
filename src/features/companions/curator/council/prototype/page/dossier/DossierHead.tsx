// PROTOTYPE ROUND (spark council-readout). The Dossier's title block: what was
// judged, for whom, in which round - and the rounds switch when there are several.
import Button from '@/features/shared/components/buttons/Button';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';

import { kindWord, StateChip } from '../../../bench/chips';
import type { CouncilRunView } from '../../../table/useCouncilRun';
import { fill, S } from './strings';

/** The skill refuses a fourth round. */
const ROUND_CAP = 3;

export function DossierHead({ subject, run }: { subject: CouncilSubjectState; run: CouncilRunView }) {
  const { t } = useTranslation();
  const detail = run.detail;
  const mode = detail?.run.mode ?? subject.mode;
  const round = detail?.run.roundNo ?? subject.roundNo ?? 1;
  const state = detail && !detail.isLatest ? (detail.run.outcome ?? subject.state) : subject.state;
  const roundWord =
    mode === 'lite' ? `${S.liteRound} ${round}` : `${S.fullRound}, ${fill(S.roundOf, { round, cap: ROUND_CAP })}`;
  return (
    <header className="flex flex-col gap-3">
      <p className="m-0 flex flex-wrap items-center gap-x-3 gap-y-1 typo-heading text-muted">
        <span className="text-primary">{subject.projectName}</span>
        <span aria-hidden="true">/</span>
        <span>{kindWord(subject, t.council.bench)}</span>
        <span aria-hidden="true">/</span>
        <span>{roundWord}</span>
      </p>
      <h2 className="m-0 typo-hero text-foreground">{subject.title}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <StateChip state={state} />
        {run.chain.length > 1 ? (
          <div role="group" aria-label={S.rounds} className="flex flex-wrap items-center gap-2">
            {run.chain.map((d) => {
              const on = d.run.id === detail?.run.id;
              return (
                <Button
                  key={d.run.id}
                  size="sm"
                  variant={on ? 'accent' : 'secondary'}
                  tone={on ? 'highlight' : undefined}
                  aria-pressed={on}
                  onClick={() => run.showRound(d.run.id)}
                >
                  <span className="typo-body">{fill(S.roundLabel, { round: d.run.roundNo })}</span>
                </Button>
              );
            })}
          </div>
        ) : null}
      </div>
    </header>
  );
}
