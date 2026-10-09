// The cover's head: the way back, whose report this is, the title at cover
// size, what kind of round - and, opposite the title, the card's one
// prominent action.
import type { ReactNode } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';

import { kindWord } from '../bench/chips';
import type { CouncilRunView } from '../table/useCouncilRun';
import { BackButton, RoundPicker } from './PageChrome';

function Dot() {
  return <i aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-muted-dark" />;
}

export function CoverHead({
  subject,
  run,
  onBack,
  action,
}: {
  subject: CouncilSubjectState;
  run: CouncilRunView;
  onBack: () => void;
  action: ReactNode;
}) {
  const { t, tx, language } = useTranslation();
  const w = t.council.verdict;
  const r = run.detail?.run;
  const lite = (r?.mode ?? subject.mode) === 'lite';
  const round = r?.roundNo ?? subject.roundNo ?? 1;
  const when = r?.finishedAt ?? r?.ingestedAt ?? null;
  const date = when
    ? new Intl.DateTimeFormat(language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      }).format(new Date(when))
    : null;
  return (
    <header className="flex flex-col gap-3">
      <div className="-ml-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <BackButton onBack={onBack} />
        <span className="typo-eyebrow text-primary">
          {w.eyebrow} · {subject.projectName}
        </span>
        <span className="ml-auto">
          <RoundPicker run={run} />
        </span>
      </div>
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="m-0 typo-hero text-foreground">{subject.title}</h2>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="typo-body-lg capitalize text-foreground">{kindWord(subject, t.council.bench)}</span>
            <Dot />
            <span className={`typo-body-lg ${lite ? 'text-status-warning' : 'text-foreground'}`}>
              {tx(lite ? w.mode_lite : w.mode_full, { round })}
            </span>
            {date ? (
              <>
                <Dot />
                <span className="typo-body-lg text-muted">{date}</span>
              </>
            ) : null}
          </div>
        </div>
        {action}
      </div>
    </header>
  );
}
