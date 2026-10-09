// PROTOTYPE ROUND (spark council-readout). Direction E - the Dossier: a
// long-form reading surface. Left, the contents rail (a named nav landmark,
// the current entry stated); centre, one ~72ch column that opens on the
// verdict as a designed claim and reads down through what must be addressed,
// each member, the evidence, the rounds and the scope; right, a sticky panel
// with the members drawn by weight and the shipped gate, always in reach.
import { useCallback, useMemo, useRef } from 'react';

import Button from '@/features/shared/components/buttons/Button';
import { Ghost, KitHost, Section, Surface } from '@/features/shared/components/kit';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import type { PageVariantProps } from '../PageHost';
import { PROTO } from '../protoStrings';
import { ContentsRail, type RailEntry } from './dossier/ContentsRail';
import { DossierHead } from './dossier/DossierHead';
import { EvidenceSection } from './dossier/EvidenceSection';
import { sectionId, unmeasuredReasons } from './dossier/format';
import { MemberSection } from './dossier/MemberSection';
import { RoundsList, ScopeFacts } from './dossier/RoundsScope';
import { S } from './dossier/strings';
import { useCurrentSection } from './dossier/useCurrentSection';
import { VerdictClaim } from './dossier/VerdictClaim';
import { MustAddressList, SummaryProse } from './dossier/VerdictProse';
import { WeightBars } from './dossier/WeightBars';
import './dossier/dossier.css';

export function Dossier({ subject, run, rubric, seats, mustAddress, hardFailures, spannedPaths, gate, onBack }: PageVariantProps) {
  const detail = run.detail;
  const mainRef = useRef<HTMLDivElement | null>(null);
  const reasons = useMemo(() => unmeasuredReasons(detail), [detail]);
  const evidenceCount = seats.reduce((n, s) => n + s.evidence.length, 0);

  const entries: RailEntry[] = useMemo(
    () => [
      { key: 'verdict', label: S.verdict },
      { key: 'must', label: S.mustAddress, count: mustAddress.length },
      { key: 'members', label: S.members },
      ...seats.map((seat) => ({ key: `member-${seat.name}`, label: seat.name, seat })),
      { key: 'evidence', label: S.evidence, count: evidenceCount },
      { key: 'rounds', label: S.rounds, count: run.chain.length },
      { key: 'scope', label: S.scope, count: spannedPaths.length },
    ],
    [mustAddress.length, seats, evidenceCount, run.chain.length, spannedPaths.length],
  );
  const { current, jump } = useCurrentSection(
    mainRef,
    entries.map((e) => e.key),
  );
  // The kit names the reader's place `selected`; the rail states it with aria-current.
  const isCurrent = (key: string) => (current === key || (key === 'members' && current?.startsWith('member-')) ? 'selected' : undefined);

  useAppKeyboard(
    useCallback(
      (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || isTypingTarget(e.target)) return false;
        onBack();
        return true;
      },
      [onBack],
    ),
    { priority: ROUTE_DECISION_PRIORITY },
  );

  return (
    <KitHost testId="council-page-dossier">
      <div className="dz" data-proto-page="Dossier">
        <ContentsRail entries={entries} current={current} onBack={onBack} onJump={jump} />

        <div ref={mainRef} className="dz-main">
          <Surface>
            <div className="dz-col">
              <div className="k-in">
                <DossierHead subject={subject} run={run} />
              </div>
              <Section id={sectionId('verdict')} title={S.verdict} state={isCurrent('verdict')}>
                <div className="k-in flex flex-col gap-6">
                  {detail ? (
                    <>
                      <VerdictClaim detail={detail} rubric={rubric} hardFailures={hardFailures} />
                      <SummaryProse
                        summary={detail.run.summary}
                        members={seats.map((s) => s.name)}
                        fallback={detail.run.summaryIsSubjectFallback}
                      />
                    </>
                  ) : run.status === 'failed' ? (
                    <div role="alert" className="flex flex-wrap items-center gap-4 rounded-card border border-status-error/40 px-5 py-4">
                      <span className="typo-body-lg text-foreground">{PROTO.readFailed}</span>
                      <Button variant="secondary" size="md" onClick={run.reload}>
                        {PROTO.retry}
                      </Button>
                    </div>
                  ) : (
                    <div aria-busy="true" aria-label={S.loading} className="flex flex-col gap-4">
                      <Ghost width="100%" height="168px" />
                      <Ghost width="92%" height="18px" />
                      <Ghost width="84%" height="18px" />
                      <Ghost width="88%" height="18px" />
                    </div>
                  )}
                </div>
              </Section>

              {detail ? (
                <>
                  <Section id={sectionId('must')} title={S.mustAddress} count={mustAddress.length} state={isCurrent('must')}>
                    <div className="k-in">
                      <MustAddressList items={mustAddress} onJump={jump} />
                    </div>
                  </Section>
                  <Section id={sectionId('members')} title={S.members} count={seats.length} state={isCurrent('members')}>
                    <div className="k-in flex flex-col gap-14">
                      {seats.map((seat) => (
                        <MemberSection key={seat.name} seat={seat} reason={reasons[seat.name] ?? null} />
                      ))}
                    </div>
                  </Section>
                  <Section id={sectionId('evidence')} title={S.evidence} count={evidenceCount} state={isCurrent('evidence')}>
                    <div className="k-in">
                      <EvidenceSection seats={seats} />
                    </div>
                  </Section>
                  <Section id={sectionId('rounds')} title={S.rounds} count={run.chain.length} state={isCurrent('rounds')}>
                    <div className="k-in">
                      <RoundsList run={run} rubric={rubric} />
                    </div>
                  </Section>
                  <Section id={sectionId('scope')} title={S.scope} state={isCurrent('scope')}>
                    <div className="k-in">
                      <ScopeFacts detail={detail} paths={spannedPaths} />
                    </div>
                  </Section>
                </>
              ) : null}
            </div>
          </Surface>
        </div>

        <aside className="dz-side" aria-label={S.members}>
          <div className="dz-side__figure">
            {seats.length ? <WeightBars seats={seats} onJump={jump} /> : <Ghost width="100%" height="300px" />}
          </div>
          <div className="dz-side__gate">{gate}</div>
        </aside>
      </div>
    </KitHost>
  );
}

export default Dossier;
