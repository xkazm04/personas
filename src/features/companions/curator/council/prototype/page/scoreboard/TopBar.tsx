// PROTOTYPE ROUND (spark council-readout). The Scoreboard's top bar: the way
// back, what was judged and in which round, and the rounds switch.
import { ArrowLeft } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';

import { kindWord, StateChip } from '../../../bench/chips';
import type { CouncilRunView } from '../../../table/useCouncilRun';
import { PROTO } from '../../protoStrings';
import { fill, S } from './strings';

const ROUND_CAP = 3;

export function TopBar({ subject, run, onBack }: { subject: CouncilSubjectState; run: CouncilRunView; onBack: () => void }) {
  const { t } = useTranslation();
  const detail = run.detail;
  const mode = detail?.run.mode ?? subject.mode;
  const round = detail?.run.roundNo ?? subject.roundNo ?? 1;
  const state = detail && !detail.isLatest ? detail.run.outcome : subject.state;
  const roundWord = mode === 'lite' ? `${S.liteRound} ${round}` : `${S.fullRound}, ${fill(S.roundOf, { round, cap: ROUND_CAP })}`;
  return (
    <header className="sb-top">
      <Button variant="ghost" size="md" icon={<ArrowLeft className="h-4 w-4" />} onClick={onBack} aria-label={PROTO.back}>
        <kbd className="rounded-interactive border border-border px-1.5 typo-code text-muted">{S.esc}</kbd>
      </Button>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="m-0 flex flex-wrap items-center gap-x-2.5 typo-body text-muted">
          <span className="text-primary">{subject.projectName}</span>
          <span aria-hidden="true">/</span>
          <span>{kindWord(subject, t.council.bench)}</span>
          <span aria-hidden="true">/</span>
          <span>{roundWord}</span>
        </p>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="m-0 typo-heading-lg text-foreground">{subject.title}</h2>
          <StateChip state={state} />
        </div>
      </div>
      {run.chain.length > 1 ? (
        <div role="group" aria-label={S.rounds} className="flex flex-none items-center gap-2">
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
    </header>
  );
}
