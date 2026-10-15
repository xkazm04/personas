/**
 * The Accept (claim) card: the body holds the goal's case and the audit
 * sample of the mandate's acts (revert, narrow); the rail holds "met when",
 * the goal's own conditions (`goal_met_when`), beside the KPI meter. Each
 * condition is a row that says only what is known; a goal that names none
 * says so in one line.
 */
import { CircleCheck, CircleDashed, CircleAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../../model/decisionModel';
import { metWhenView, type MetRow } from '../../mandate/claimModel';
import { useGoalMetWhen } from '../../mandate/useGoalMetWhen';
import { DeckSection } from '../DeckFold';
import { ProseBody } from '../ProseBody';
import { AuditSample } from './AuditSample';
import type { ShapeController } from './useShapeController';

const CHECK_ICON = { success: CircleCheck, warning: CircleAlert, neutral: CircleDashed, accent: CircleDashed, danger: CircleAlert } as const;
const CHECK_INK = { success: 'text-status-success', warning: 'text-status-warning', neutral: 'au-quiet', accent: 'text-primary', danger: 'text-status-error' } as const;

function Row({ row }: { row: MetRow }) {
  const Icon = CHECK_ICON[row.tone];
  return (
    <li className="flex items-start gap-2" data-tone={row.tone} data-testid={`claim-met-${row.id}`}>
      <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${CHECK_INK[row.tone]}`} aria-hidden />
      <span className="flex min-w-0 flex-col">
        <span className="typo-body text-foreground [overflow-wrap:anywhere]">{row.text}</span>
        {row.hint && <span className="typo-caption">{row.hint}</span>}
      </span>
    </li>
  );
}

function MetWhen({ item }: { item: DecisionItem }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const view = metWhenView(useGoalMetWhen(item.sourceId), item, m, tx);
  return (
    <DeckSection title={m.ml_claim_met}>
      <div data-testid="claim-met-when" data-state={view.kind}>
        {view.kind === 'loading' && <span className="typo-body">{m.ml_loading}</span>}
        {view.kind === 'note' && (
          <span className={`typo-body ${view.tone === 'warning' ? 'text-status-warning' : 'text-foreground'}`}>{view.text}</span>
        )}
        {view.kind === 'rows' && (
          <ul className="flex flex-col gap-1.5">
            {view.rows.map((r) => <Row key={r.id} row={r} />)}
          </ul>
        )}
      </div>
    </DeckSection>
  );
}

export function ClaimBody({ item, ctl }: { item: DecisionItem; ctl: ShapeController }) {
  return (
    <ProseBody item={item}>
      <AuditSample claim={ctl.claim} mandate={ctl.mandate} />
    </ProseBody>
  );
}

/** The claim's rail section: met-when, beside the KPI meter it reads. */
export function ClaimRail({ item }: { item: DecisionItem }) {
  return <MetWhen item={item} />;
}
