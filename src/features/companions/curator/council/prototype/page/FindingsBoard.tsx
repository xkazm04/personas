// PROTOTYPE ROUND (spark council-readout). Direction G - the Findings board.
//
// The must-address items are the board: each is a card carrying the member
// that raised it and the evidence behind it. The members are the filter
// chips (with their scores), the overall and coverage a compact strip in the
// header, the council's own prose a folded block, and the shipped gate is
// docked at the bottom where it is always in reach.
import { useMemo, useState } from 'react';

import type { PageVariantProps } from '../PageHost';
import { PROTO } from '../protoStrings';
import { BoardBody } from './findings/BoardBody';
import { BoardHeader } from './findings/BoardHeader';
import { buildCards, unmeasuredReasons } from './findings/boardModel';
import { CouncilReading } from './findings/CouncilReading';
import { MemberChips } from './findings/MemberChips';
import { Ghost, ReadFailed, useEscBack } from './findings/PageChrome';
import { ScoreStrip } from './findings/ScoreStrip';

const S = {
  lite: 'Lite round only: readable now, decidable once a full council runs.',
};

export function FindingsBoard({
  subject,
  run,
  rubric,
  seats,
  mustAddress,
  spannedPaths,
  gate,
  onBack,
}: PageVariantProps) {
  const [active, setActive] = useState<string | null>(null);
  useEscBack(onBack);
  const detail = run.detail;
  const cards = useMemo(() => buildCards(mustAddress, seats), [mustAddress, seats]);
  const reasons = useMemo(() => unmeasuredReasons(detail?.verdicts ?? []), [detail]);
  const ready = run.status === 'loaded' && detail != null;
  const lite = (detail?.run.mode ?? subject.mode) === 'lite';

  return (
    <div data-proto-page="FindingsBoard" className="flex min-h-0 flex-1 flex-col bg-background">
      <main className="min-h-0 flex-1 overflow-y-auto" aria-busy={run.status === 'loading'}>
        <BoardHeader
          subject={subject}
          run={run}
          onBack={onBack}
          strip={
            ready ? (
              <ScoreStrip
                overall={detail.run.overall}
                coverage={detail.run.coverage}
                trust={detail.run.trustState}
                rubric={rubric}
              />
            ) : (
              <Ghost className="h-28 w-[26rem]" />
            )
          }
        />
        {/* The members stay pinned while the board scrolls: they are its filter. */}
        <div className="sticky top-0 z-10 border-b border-primary/15 bg-background/95 px-8 py-3 backdrop-blur-sm">
          {ready ? (
            <MemberChips seats={seats} active={active} onPick={setActive} />
          ) : (
            <Ghost className="h-[4.5rem] w-full" />
          )}
        </div>
        <div className="mx-auto flex max-w-[110rem] flex-col gap-6 px-8 py-6">
          {run.status === 'failed' ? <ReadFailed run={run} /> : null}
          {ready ? (
            <>
              <BoardBody cards={cards} seats={seats} active={active} reasons={reasons} />
              <CouncilReading run={detail.run} spanned={spannedPaths.length} />
            </>
          ) : run.status !== 'failed' ? (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2" aria-label={PROTO.loading}>
              <Ghost className="h-56" />
              <Ghost className="h-56" />
            </div>
          ) : null}
        </div>
      </main>

      <footer className="border-t border-primary/15 bg-background px-8 py-3 shadow-elevation-4">
        <div className="mx-auto flex max-w-[110rem] flex-col gap-2">
          {lite ? <p className="m-0 typo-body text-status-warning">{S.lite}</p> : null}
          {gate}
        </div>
      </footer>
    </div>
  );
}

export default FindingsBoard;
