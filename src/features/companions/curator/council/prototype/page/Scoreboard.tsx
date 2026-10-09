// PROTOTYPE ROUND (spark council-readout). Direction F - Scoreboard + drill.
// A band of LARGE columns across the top - the overall as its anchor, then
// one column per member, each a water level against the bar (one dashed line
// through the whole band), its floor, confidence and findings as squares.
// Pick a column and its findings and evidence fill the page below; what must
// be addressed sits between the two; the gate is pinned in the footer.
import { useCallback, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Info } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { Ghost, KitHost } from '@/features/shared/components/kit';
import { ROUTE_DECISION_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';

import type { PageVariantProps } from '../PageHost';
import { PROTO } from '../protoStrings';
import { BandTab } from './scoreboard/BandTab';
import { unmeasuredReasons, useScore } from './scoreboard/format';
import { MemberDrill } from './scoreboard/MemberDrill';
import { MustStrip } from './scoreboard/MustStrip';
import { OverallDrill } from './scoreboard/OverallDrill';
import { fill, S } from './scoreboard/strings';
import { AnchorFace, MemberFace, memberLabel } from './scoreboard/Tiles';
import { TopBar } from './scoreboard/TopBar';
import './scoreboard/scoreboard.css';

const OVERALL = '__overall';
const PANEL = 'sb-drill-panel';
const tabId = (key: string) => `sb-tab-${key}`;

export function Scoreboard({ subject, run, rubric, seats, mustAddress, hardFailures, spannedPaths, gate, onBack }: PageVariantProps) {
  const detail = run.detail;
  const score = useScore();
  const [picked, setPicked] = useState<string>(OVERALL);
  const reasons = useMemo(() => unmeasuredReasons(detail), [detail]);
  const seat = seats.find((s) => s.name === picked) ?? null;
  const selected = seat ? seat.name : OVERALL;
  const order = [OVERALL, ...seats.map((s) => s.name)];

  useAppKeyboard(
    useCallback(
      (e: globalThis.KeyboardEvent) => {
        if (e.key !== 'Escape' || isTypingTarget(e.target)) return false;
        onBack();
        return true;
      },
      [onBack],
    ),
    { priority: ROUTE_DECISION_PRIORITY },
  );

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = order[(order.indexOf(selected) + step + order.length) % order.length] ?? OVERALL;
    setPicked(next);
    document.getElementById(tabId(next))?.focus();
  };

  return (
    <KitHost testId="council-page-scoreboard">
      <div className="sb" data-proto-page="Scoreboard">
        <TopBar subject={subject} run={run} onBack={onBack} />
        <div className="sb-scroll">
          {detail ? (
            <>
              <div role="tablist" aria-label={S.band} className="sb-band" style={{ '--sb-n': seats.length } as CSSProperties}>
                <BandTab
                  id={tabId(OVERALL)}
                  panelId={PANEL}
                  selected={selected === OVERALL}
                  anchor
                  hollow={detail.run.mode === 'lite'}
                  label={`${S.overall} ${detail.run.overall == null ? S.noOverall : score(detail.run.overall)}`}
                  onSelect={() => setPicked(OVERALL)}
                  onKeyDown={onTabKey}
                >
                  <AnchorFace detail={detail} threshold={rubric.threshold} coverageFloor={rubric.coverageFloor} />
                </BandTab>
                {seats.map((s) => (
                  <BandTab
                    key={s.name}
                    id={tabId(s.name)}
                    panelId={PANEL}
                    selected={selected === s.name}
                    hollow={s.score == null}
                    label={memberLabel(s, score)}
                    onSelect={() => setPicked(s.name)}
                    onKeyDown={onTabKey}
                  >
                    <MemberFace seat={s} />
                  </BandTab>
                ))}
              </div>
              <p className="m-0 -mt-2 flex items-start gap-2 typo-body text-foreground">
                <Info className="mt-1 h-4 w-4 flex-none text-primary" aria-hidden="true" />
                <span>
                  {detail.run.trustState === 'trusted' ? S.trusted : S.advisory}
                  {detail.run.mode === 'lite' ? ` ${S.liteNote}` : ''}
                  {!detail.isLatest ? ` ${fill(S.oldRound, { round: detail.run.roundNo })}` : ''}
                </span>
              </p>
              <MustStrip items={mustAddress} onMember={setPicked} />
              <div role="tabpanel" id={PANEL} aria-labelledby={tabId(selected)} className="pt-2">
                {seat ? (
                  <MemberDrill seat={seat} reason={reasons[seat.name] ?? null} />
                ) : (
                  <OverallDrill detail={detail} members={seats.map((s) => s.name)} hardFailures={hardFailures} paths={spannedPaths} />
                )}
              </div>
            </>
          ) : run.status === 'failed' ? (
            <div role="alert" className="flex flex-wrap items-center gap-4 rounded-card border border-status-error/40 px-5 py-4">
              <span className="typo-body-lg text-foreground">{PROTO.readFailed}</span>
              <Button variant="secondary" size="md" onClick={run.reload}>
                {PROTO.retry}
              </Button>
            </div>
          ) : (
            <div aria-busy="true" aria-label={S.loading} className="sb-band" style={{ '--sb-n': 5 } as CSSProperties}>
              {Array.from({ length: 6 }, (_, i) => (
                <Ghost key={i} width="100%" height="300px" />
              ))}
            </div>
          )}
        </div>
        <footer className="sb-foot">{gate}</footer>
      </div>
    </KitHost>
  );
}

export default Scoreboard;
