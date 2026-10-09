// PROTOTYPE ROUND (spark council-readout, direction G). A must-address line
// as the board's primary card: who raised it, the sentence itself at reading
// size, and the proof under it - the finding it came from with that
// finding's evidence, or the member's bar against its floor, or the reason
// a member could not be measured.
import type { Finding } from '../../../table/runModel';
import type { BoardCard } from './boardModel';
import { EvidenceRefs, FindingDetail, SEVERITY_RULE, SeverityWord } from './FindingItem';
import { MemberIcon, ScoreBar, useMemberName, useScore } from './marks';

const S = {
  floorHit: 'Floor hit, stopped the round',
  notMeasured: 'Not measured',
  floorLine: (score: string, floor: string) => `${score} against its floor of ${floor}`,
  alsoHigh: 'Also high from this member',
  why: 'Why it was not measured',
};

const RULE: Record<BoardCard['kind'], string> = {
  floor: 'bg-status-error',
  finding: '',
  unmeasured: 'bg-muted-dark',
  note: 'bg-primary',
};

function Members({ names, dashed }: { names: string[]; dashed: boolean }) {
  const name = useMemberName();
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {names.map((n) => (
        <span key={n} className="inline-flex items-center gap-2.5">
          <span
            className={`flex h-9 w-9 items-center justify-center rounded-full border ${
              dashed ? 'border-dashed border-muted-dark text-muted' : 'border-primary/40 bg-primary/10 text-primary'
            }`}
          >
            <MemberIcon name={n} className="h-[18px] w-[18px]" />
          </span>
          <span className="typo-heading capitalize text-foreground">{name(n)}</span>
        </span>
      ))}
    </span>
  );
}

function AlsoHigh({ findings }: { findings: Finding[] }) {
  if (findings.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <span className="typo-label text-muted">{S.alsoHigh}</span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {findings.map((f) => (
          <li key={f.id} className="flex items-baseline gap-2.5">
            <i aria-hidden="true" className={`mt-2 h-2 w-2 shrink-0 rounded-full ${SEVERITY_RULE.high}`} />
            <span className="typo-body-lg text-foreground">{f.title}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The member's unmeasured reason, minus the sentence the card already says. */
function ReasonRest({ reason, said }: { reason: string; said: string }) {
  const rest = reason.startsWith(said) ? reason.slice(said.length).trim() : reason === said ? '' : reason;
  return rest ? <FindingDetail detail={rest} /> : null;
}

export function MustCard({
  card,
  reason,
  hideMembers = false,
}: {
  card: BoardCard;
  reason: string | null;
  /** The board is already filtered to this one member, whose name heads the page. */
  hideMembers?: boolean;
}) {
  const score = useScore();
  const seat = card.seat;
  const rule = card.finding ? SEVERITY_RULE[card.finding.severity] : RULE[card.kind];
  const dashed = card.kind === 'unmeasured';
  return (
    <article
      data-testid="findings-must-card"
      data-kind={card.kind}
      className={`relative flex flex-col gap-4 rounded-card border py-5 pl-7 pr-6 ${
        dashed
          ? 'border-dashed border-muted-dark/60 bg-transparent'
          : 'border-card-border bg-card-bg shadow-elevation-1'
      }`}
    >
      <i aria-hidden="true" className={`absolute inset-y-5 left-0 w-1.5 rounded-pill ${rule}`} />
      <header className={`flex flex-wrap items-center gap-3 ${hideMembers ? '' : 'justify-between'}`}>
        {hideMembers ? null : <Members names={card.members} dashed={dashed} />}
        {card.finding ? <SeverityWord severity={card.finding.severity} /> : null}
        {card.kind === 'floor' ? <span className="typo-label text-status-error">{S.floorHit}</span> : null}
        {dashed ? <span className="typo-label text-muted">{S.notMeasured}</span> : null}
      </header>

      <p className="m-0 typo-section-title text-foreground">{card.text}</p>

      {card.kind === 'floor' && seat && seat.score != null && seat.floor != null ? (
        <div className="flex flex-col gap-2">
          <div className="max-w-md">
            <ScoreBar score={seat.score} threshold={seat.threshold} floor={seat.floor} floorHit height="h-3" />
          </div>
          <span className="typo-body text-status-error">{S.floorLine(score(seat.score), score(seat.floor))}</span>
        </div>
      ) : null}

      {card.finding ? (
        <>
          {card.finding.detail ? <FindingDetail detail={card.finding.detail} /> : null}
          <EvidenceRefs items={card.evidence} />
        </>
      ) : null}

      {dashed && reason ? <ReasonRest reason={reason} said={card.text} /> : null}

      <AlsoHigh findings={card.alsoHigh} />
    </article>
  );
}
