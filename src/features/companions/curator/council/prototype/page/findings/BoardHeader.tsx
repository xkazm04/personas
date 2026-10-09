// PROTOTYPE ROUND (spark council-readout, direction G). The board's head:
// the way back beside the title, what kind of round this is, and the score
// strip on the right. It scrolls away with the board; the member chips under
// it stay pinned.
import type { ReactNode } from 'react';

import type { CouncilSubjectState } from '@/lib/bindings/CouncilSubjectState';
import { useTranslation } from '@/i18n/useTranslation';

import { kindWord, StateChip, Tag } from '../../../bench/chips';
import type { CouncilRunView } from '../../../table/useCouncilRun';
import { BackButton, RoundPicker } from './PageChrome';

const S = {
  mode: (lite: boolean, round: number) => `${lite ? 'Lite' : 'Full'} council, round ${round} of 3`,
};

export function BoardHeader({
  subject,
  run,
  onBack,
  strip,
}: {
  subject: CouncilSubjectState;
  run: CouncilRunView;
  onBack: () => void;
  strip: ReactNode;
}) {
  const { t } = useTranslation();
  const r = run.detail?.run;
  const lite = (r?.mode ?? subject.mode) === 'lite';
  const round = r?.roundNo ?? subject.roundNo ?? 1;
  const state = r && !run.detail?.isLatest ? r.outcome : subject.state;
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-10 gap-y-5 bg-gradient-to-b from-primary/[0.07] to-transparent px-8 pb-4 pt-6">
      <div className="flex min-w-0 flex-1 items-start gap-5">
        <div className="pt-1.5">
          <BackButton onBack={onBack} iconOnly />
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <h2 className="m-0 typo-hero text-foreground">{subject.title}</h2>
          <div className="flex flex-wrap items-center gap-2.5">
            <StateChip state={state} />
            <Tag>{subject.projectName}</Tag>
            <Tag>
              <span className="capitalize">{kindWord(subject, t.council.bench)}</span>
            </Tag>
            <Tag>
              <span className={lite ? 'text-status-warning' : undefined}>{S.mode(lite, round)}</span>
            </Tag>
            <RoundPicker run={run} />
          </div>
        </div>
      </div>
      {strip}
    </header>
  );
}
