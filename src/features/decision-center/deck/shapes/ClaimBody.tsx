/**
 * The Accept (claim) card: the body holds the goal's case and the audit
 * sample of the mandate's acts (revert, narrow); the rail holds "met when"
 * beside the KPI meter (what is honestly known: the KPI against its target,
 * and a line saying the UAT and council checks are not read yet).
 */
import { CircleCheck, CircleDashed, CircleAlert } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { DecisionItem } from '../../model/decisionModel';
import { kpiCheck } from '../../mandate/claimModel';
import { DeckSection } from '../DeckFold';
import { ProseBody } from '../ProseBody';
import { AuditSample } from './AuditSample';
import type { ShapeController } from './useShapeController';

const CHECK_ICON = { success: CircleCheck, warning: CircleAlert, neutral: CircleDashed, accent: CircleDashed, danger: CircleAlert } as const;
const CHECK_INK = { success: 'text-status-success', warning: 'text-status-warning', neutral: 'text-foreground', accent: 'text-primary', danger: 'text-status-error' } as const;

function MetWhen({ item }: { item: DecisionItem }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const kpi = kpiCheck(item, m, tx);
  const Icon = CHECK_ICON[kpi.tone];
  return (
    <DeckSection title={m.ml_claim_met}>
      <ul className="flex flex-col gap-1" data-testid="claim-met-when">
        <li className="flex items-start gap-2" data-tone={kpi.tone}>
          <Icon className={`mt-0.5 h-4 w-4 flex-shrink-0 ${CHECK_INK[kpi.tone]}`} aria-hidden />
          <span className="typo-body text-foreground">{kpi.text}</span>
        </li>
        <li className="flex items-start gap-2">
          <CircleDashed className="mt-0.5 h-4 w-4 flex-shrink-0 au-quiet" aria-hidden />
          <span className="typo-caption">{m.ml_claim_met_unread}</span>
        </li>
      </ul>
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
