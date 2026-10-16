/**
 * WP12 variant 3 - BRIEFING FIRST: what needs you on top, what happened under
 * it, the conversation below.
 *   left    the projects in the Stewards row grammar
 *   top     NEEDS YOU: the ask in hand as the deck's card head with its fixed
 *           verdict dock beside the rest of the project's asks (peek rows)
 *   middle  WHAT HAPPENED: one plate row per run and deliberation, outcome
 *           first (lamp, the outcome, the goal, age); Drive opens the
 *           deliberation's controls as a lane-like glass PEEK anchored on its
 *           row, the way a lane button opens its peek
 *   bottom  the thread: talk only (runs and deliberations are a one-line
 *           mark there, pointing up), and the composer
 */
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import { Engraved, Lamp } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';
import { Keycap } from '@/features/decision-center/deck/parts';
import { AskDock, AskHead } from './conversationVariantsDeck';
import { Composer, DayRule, ProposalBand, TalkLine } from './conversationVariantsBands';
import { ASKS, COPY, PROJECTS, THREAD, fill, type ThreadRow } from './conversationVariantsData';
import { Frame, ThreadScroll } from './conversationVariantsFrame';
import { DriveControls } from './conversationVariantsDrive';
import { ProjectsPlate } from './conversationVariantsRail';

const at = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
type Work = Extract<ThreadRow, { kind: 'run' | 'delib' }>;
const WORK = THREAD.filter((r): r is Work => r.kind === 'run' || r.kind === 'delib').reverse();

function Briefing() {
  const [focus, setFocus] = useState(0);
  const ask = ASKS[focus]!;
  return (
    <section className="au-scope ae-plate flex min-w-0 flex-col overflow-hidden rounded-card" data-testid="cv-v3-briefing">
      <div className="flex h-10 flex-shrink-0 items-center gap-2 border-b border-border px-3">
        <Lamp lamp={{ tone: 'warn', lit: true }} />
        <Engraved>{COPY.needsYou}</Engraved>
        <span className="typo-data tabular-nums text-status-warning"><Numeric value={ASKS.length} /></span>
        <span className="flex-1" />
        <span className="typo-caption tabular-nums">{fill(COPY.ofTotal, { n: focus + 1, total: ASKS.length })}</span>
        <span className="flex items-center gap-1 typo-caption"><Keycap>J</Keycap><Keycap>K</Keycap> {COPY.walk}</span>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <AskHead ask={ask} body={false} />
        <AskDock ask={ask} inline />
      </div>
      <div className="grid grid-cols-3 gap-1 border-t border-border p-1.5">
        {ASKS.map((a, i) => i === focus ? null : <AskChip key={a.id} title={a.title} tier={a.tier} onFocus={() => setFocus(i)} />)}
      </div>
    </section>
  );
}

/** The other asks, one line each: the peek row's stripe and title, nothing else (J/K reaches them). */
function AskChip({ title, tier, onFocus }: { title: string; tier: number; onFocus: () => void }) {
  return (
    <Button variant="ghost" size="xs" onClick={onFocus} className={`au-row au-tier-${tier} min-w-0 justify-start! gap-2 rounded-card px-2! py-1.5! text-left [&>span]:flex [&>span]:min-w-0 [&>span]:items-center [&>span]:gap-2`}>
      <span className="au-stripe h-4 flex-shrink-0" aria-hidden />
      <span className="min-w-0 truncate typo-caption text-foreground">{title}</span>
    </Button>
  );
}

function WorkRow({ row, onDrive, driving }: { row: Work; onDrive: () => void; driving: boolean }) {
  const { t } = useTranslation();
  const lamp = row.kind === 'delib' ? { tone: 'run' as const, lit: true }
    : row.state === 'review' ? { tone: 'warn' as const, lit: true } : { tone: 'ok' as const, lit: false };
  const word = row.kind === 'delib' ? COPY.deliberation : row.state === 'review' ? COPY.runWaiting : COPY.runDone;
  const outcome = row.kind === 'delib' ? `${COPY.leaning}: ${row.leaning}` : row.outcome;
  const sub = row.kind === 'delib' ? row.topic : row.goal;
  return (
    <div className="ae-plan relative flex-col items-stretch! gap-0.5!">
      <span className="flex w-full min-w-0 items-center gap-2">
        <Lamp lamp={lamp} />
        <Engraved className="flex-shrink-0">{word}</Engraved>
        <span className="min-w-0 flex-1 truncate typo-caption">{sub}</span>
        <span className="flex-shrink-0 whitespace-nowrap typo-caption"><RelativeTime timestamp={at(row.minutes)} /></span>
        {row.kind === 'delib'
          ? <Button variant="accent" tone="agent" size="xs" aria-pressed={driving} onClick={onDrive} data-testid="cv-v3-drive">{t.monitor.conv_drive}</Button>
          : <ChevronDown className="h-4 w-4 flex-shrink-0 text-foreground" aria-hidden />}
      </span>
      <span className="line-clamp-2 pl-4 typo-body text-foreground">{outcome}</span>
      {row.kind === 'delib' && driving && (
        <div className="au-scope au-keys absolute right-0 top-full z-30 mt-1 w-[400px] rounded-card p-3" data-testid="cv-v3-peek">
          <DriveControls peek />
        </div>
      )}
    </div>
  );
}

function ThreadMark({ row }: { row: Work }) {
  const word = row.kind === 'delib' ? COPY.deliberation : row.state === 'review' ? COPY.runWaiting : COPY.runDone;
  const what = row.kind === 'delib' ? row.topic : row.goal;
  return (
    <div className="flex items-center gap-2 py-1 pl-9">
      <span className="h-px w-4 bg-border" aria-hidden />
      <Engraved>{word}</Engraved>
      <span className="truncate typo-caption">{what}</span>
    </div>
  );
}

export function VariantThree({ drive = false }: { drive?: boolean }) {
  const [active, setActive] = useState('t-personas-desktop');
  const [driving, setDriving] = useState(drive);
  return (
    <Frame title={<span className="typo-heading text-foreground">{`· ${PROJECTS[0]!.name}`}</span>}>
      <div className="w-[304px] flex-shrink-0 min-h-0"><ProjectsPlate active={active} onSelect={setActive} /></div>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        <div className="grid flex-shrink-0 grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] gap-2">
          <Briefing />
          <section className="ae-plate relative z-20 flex min-w-0 flex-col rounded-card">
            <div className="flex h-10 flex-shrink-0 items-center border-b border-border px-3"><Engraved>{COPY.happened}</Engraved></div>
            <div className="space-y-1 p-1.5">
              {WORK.map((w) => <WorkRow key={w.id} row={w} driving={driving} onDrive={() => setDriving((v) => !v)} />)}
            </div>
          </section>
        </div>
        <section className="ae-plate flex min-h-0 flex-1 flex-col overflow-hidden rounded-card">
          <ThreadScroll className="px-3 py-1">
            {THREAD.map((r, i) => r.kind === 'day' ? <DayRule key={i} label={r.label} />
              : r.kind === 'talk' ? <TalkLine key={r.id} row={r} />
              : r.kind === 'proposal' ? <ProposalBand key={r.id} row={r} />
              : <ThreadMark key={r.id} row={r} />)}
          </ThreadScroll>
          <Composer team="Personas Desktop" />
        </section>
      </div>
    </Frame>
  );
}
