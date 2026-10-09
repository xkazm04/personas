// PROTOTYPE ROUND (spark council-readout). Direction H - the Hybrid card.
//
// In the app, a council is a calm verdict card a person recognises at first
// sight, like the cover of a report: title and round, the overall as a dial
// against the bar beside the members as one compact figure, outcome and
// trust in one line, the first two things to address, and the gate. The
// full reading lives in the browser report, one prominent action away.
import { useMemo } from 'react';

import type { PageVariantProps } from '../PageHost';
import { PROTO } from '../protoStrings';
import { buildCards } from './findings/boardModel';
import { Ghost, ReadFailed, useEscBack } from './findings/PageChrome';
import { Backdrop } from './hybrid/Backdrop';
import { CoverHead } from './hybrid/CoverHead';
import { MemberColumns } from './hybrid/MemberColumns';
import { MustPreview } from './hybrid/MustPreview';
import { ReportAction } from './hybrid/ReportAction';
import { VerdictGauge } from './hybrid/VerdictGauge';
import { VerdictLine } from './hybrid/VerdictLine';

export function HybridCard({ subject, run, rubric, seats, mustAddress, gate, onBack }: PageVariantProps) {
  useEscBack(onBack);
  const detail = run.detail;
  const cards = useMemo(() => buildCards(mustAddress, seats), [mustAddress, seats]);
  const ready = run.status === 'loaded' && detail != null;
  const r = detail?.run;
  const state = r && !detail?.isLatest ? r.outcome : subject.state;

  return (
    <div data-proto-page="HybridCard" className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <Backdrop seed={subject.slug} />
      {/* The cover never outgrows the window: its head and its gate stay put
          and only the reading between them scrolls on a short screen. */}
      <div className="relative flex min-h-0 flex-1 flex-col px-6 py-2 2xl:py-10">
        <article
          className="m-auto flex max-h-full min-h-0 w-full max-w-[72rem] flex-col gap-4 rounded-modal border border-primary/25 bg-background px-10 pb-5 pt-4 shadow-elevation-4"
          aria-busy={run.status === 'loading'}
        >
          <div className="shrink-0">
            <CoverHead
              subject={subject}
              run={run}
              onBack={onBack}
              action={r ? <ReportAction runDir={r.runDir} /> : null}
            />
          </div>

          {run.status === 'failed' ? <ReadFailed run={run} /> : null}

          {ready && r ? (
            <div className="grid min-h-0 shrink grid-cols-1 gap-x-12 gap-y-8 overflow-y-auto border-y border-primary/15 py-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
              <div className="flex flex-col justify-center gap-5">
                <div className="flex items-center gap-8">
                  <VerdictGauge
                    size={172}
                    overall={r.overall}
                    threshold={rubric.threshold}
                    floorHit={seats.some((s) => s.floorHit)}
                  />
                  <div className="min-w-0 flex-1">
                    <MemberColumns seats={seats} />
                  </div>
                </div>
                <VerdictLine
                  state={state}
                  trust={r.trustState}
                  coverage={r.coverage}
                  rubric={rubric}
                  lite={r.mode === 'lite'}
                />
              </div>
              <div className="lg:border-l lg:border-primary/15 lg:pl-12">
                <MustPreview cards={cards} />
              </div>
            </div>
          ) : run.status !== 'failed' ? (
            <div className="grid grid-cols-1 gap-8 py-8 lg:grid-cols-2" aria-label={PROTO.loading}>
              <Ghost className="h-52" />
              <Ghost className="h-52" />
            </div>
          ) : null}

          <div className="shrink-0">{gate}</div>
        </article>
      </div>
    </div>
  );
}

export default HybridCard;
