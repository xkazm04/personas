/**
 * WP12 variants: a deliberation's controls (today's DeliberationRail: advance,
 * run to budget / stop, split / run tracks / merge, the gated capability, the
 * escalation decision, proposal to assignment, the agenda) in the dock's
 * anatomy: the state as one head (eyebrow + lamp, the leaning as the title,
 * round and spend as figures beside the plate meter), every control as a deck
 * `Branch` row with its digit, the agenda as lamp rows. `peek` draws it as a
 * lane-like glass peek (variant 3) with the peek's key footer.
 */
import { CircleDot, CheckCircle2, GitBranch, Play, SkipForward } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { Engraved, Lamp } from '@/features/fleet/monitor/grid/prototype/entry-e/parts';
import { Branch } from '@/features/decision-center/deck/DeckDock';
import { Keycap } from '@/features/decision-center/deck/parts';
import { COPY, THREAD, fill } from './conversationVariantsData';

const AGENDA = [
  { item: 'Measure cold start with one chunk', done: true },
  { item: 'Decide where the editor loads', done: false },
  { item: 'Agree the size budget for the settings route', done: false },
];

export function DriveControls({ peek = false }: { peek?: boolean }) {
  const { t } = useTranslation();
  const m = t.monitor;
  const d = THREAD.find((r) => r.kind === 'delib');
  if (!d || d.kind !== 'delib') return null;
  const noop = () => undefined;
  const icon = (I: typeof Play) => <I className="h-4 w-4" aria-hidden />;
  return (
    <div className="flex flex-col gap-3" data-testid="cv-drive">
      <div className="flex flex-col gap-1">
        <span className="flex items-center gap-2">
          <Lamp lamp={{ tone: 'run', lit: true }} />
          <Engraved>{COPY.deliberation} · {COPY.converging}</Engraved>
        </span>
        <span className="typo-heading text-foreground">{d.topic}</span>
        <span className="typo-body text-foreground"><span className="typo-label text-role-agent">{COPY.leaning}: </span>{d.leaning}</span>
        <span className="mt-1 flex items-center gap-3">
          <span className="typo-data tabular-nums text-foreground">{fill(COPY.roundOf, { round: d.round })}</span>
          <span className="ae-bar ae-t-agent min-w-0 flex-1" aria-hidden><i style={{ width: `${(d.spent / d.budget) * 100}%` }} /></span>
          <span className="typo-data tabular-nums text-foreground">$<Numeric value={d.spent} precision={2} /> / <Numeric value={d.budget} precision={2} /></span>
        </span>
      </div>
      <div className="au-scope flex flex-col gap-1.5">
        <Branch k="1" label={m.delib_advance} icon={icon(Play)} accent onClick={noop} />
        <Branch k="2" label={m.delib_run_budget} icon={icon(SkipForward)} onClick={noop} />
        <Branch k="3" label={m.delib_split} icon={icon(GitBranch)} onClick={noop} />
      </div>
      <div className="flex flex-col gap-1">
        <Engraved>{m.delib_agenda}</Engraved>
        {AGENDA.map((a) => (
          <span key={a.item} className="flex items-start gap-2 typo-body text-foreground">
            {a.done ? <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-success" aria-hidden /> : <CircleDot className="mt-0.5 h-4 w-4 flex-shrink-0 text-foreground" aria-hidden />}
            {a.item}
          </span>
        ))}
      </div>
      {peek && (
        <div className="flex items-center gap-1.5 border-t border-border pt-2 typo-caption">
          <Keycap>1</Keycap><Keycap>2</Keycap><Keycap>3</Keycap> {COPY.pick}
          <span className="ml-auto flex items-center gap-1.5"><Keycap>Esc</Keycap> {COPY.close}</span>
        </div>
      )}
    </div>
  );
}
