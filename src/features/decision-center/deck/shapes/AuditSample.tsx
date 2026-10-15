/**
 * The claim's audit sample: a few of the mandate's acts at random, each a
 * row the operator picks with its digit (`1`-`3`); the picked row offers the
 * mandate page's two doors, revert (`V`) and narrow the scope it was taken
 * under (`N`). A refusal (an act that cannot be taken back, one already
 * reverted) is said under the rows, in place.
 */
import { Minimize2, Undo2 } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { actorLabel } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/mandateCopy';
import { canRevert, narrowableScope } from '@/features/fleet/monitor/grid/prototype/entry-e/mandate/MandateRail';
import { useTranslation } from '@/i18n/useTranslation';
import type { CharterAct } from '@/lib/bindings/CharterAct';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import type { MonitorCopy } from '../deckMeta';
import { DeckSection } from '../DeckFold';
import { Keycap } from '../parts';
import type { ClaimShape } from './useClaimShape';

function kindWord(m: MonitorCopy, kind: string): string {
  switch (kind) {
    case 'report': return m.ml_kind_report;
    case 'review': return m.ml_kind_review;
    case 'incident': return m.ml_kind_incident;
    case 'idea': return m.ml_kind_idea;
    default: return m.ml_kind_item;
  }
}

function Row({ act, index, picked, onPick }: { act: CharterAct; index: number; picked: boolean; onPick: () => void }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  return (
    <Button
      variant="ghost"
      size="sm"
      block
      role="radio"
      aria-checked={picked}
      aria-label={tx(m.ml_claim_pick, { index: index + 1 })}
      data-accent={picked ? '' : undefined}
      onClick={onPick}
      className="au-branch au-lift h-auto justify-start! rounded-input px-3! py-1.5! hover:bg-transparent [&>span:last-child]:flex [&>span:last-child]:w-full [&>span:last-child]:items-center [&>span:last-child]:gap-3"
      data-testid={`claim-act-${index + 1}`}
    >
      <Keycap>{index + 1}</Keycap>
      <span className="min-w-0 flex-1 text-left typo-body text-foreground">
        {tx(m.ml_claim_act_line, { actor: actorLabel(m, act.actor), kind: kindWord(m, act.itemKind) })}
      </span>
      <span className="flex flex-shrink-0 items-center gap-2 typo-caption">
        {act.revertedAt ? m.ml_act_reverted : !act.reversible ? m.ml_act_final : null}
        <span>{tx(m.ml_act_version, { version: act.envelopeVersion })}</span>
        <RelativeTime timestamp={act.createdAt} className="typo-caption" />
      </span>
    </Button>
  );
}

export function AuditSample({ claim, mandate }: { claim: ClaimShape; mandate: MandateSummary | null }) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const act = claim.picked !== null ? claim.sample?.[claim.picked] ?? null : null;
  const status = claim.orphan
    ? m.ml_claim_audit_orphan
    : claim.failed && !claim.sample ? m.ml_claim_audit_failed
      : !claim.sample ? m.ml_claim_audit_loading
        : claim.sample.length === 0 ? m.ml_claim_audit_none : null;
  return (
    <DeckSection title={m.ml_claim_audit}>
      {status ? <span className="typo-body text-foreground">{status}</span> : (
        <div className="flex flex-col gap-1.5" role="radiogroup" aria-label={m.ml_claim_audit} data-testid="claim-audit">
          <span className="typo-caption">{tx(m.ml_claim_audit_summary, { count: claim.sample!.length, total: claim.total })}</span>
          {claim.sample!.map((a, i) => <Row key={a.id} act={a} index={i} picked={claim.picked === i} onPick={() => claim.pick(i)} />)}
          {act && (
            <div className="flex items-center gap-2 pt-1">
              <Button variant="secondary" size="sm" disabled={!canRevert(act)} onClick={claim.revert} icon={<Undo2 className="h-3.5 w-3.5" aria-hidden />} className="[&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-1.5" data-testid="claim-revert">
                {m.ml_claim_revert} <Keycap>V</Keycap>
              </Button>
              <Button variant="secondary" size="sm" disabled={!mandate || !narrowableScope(mandate, act)} onClick={claim.narrow} icon={<Minimize2 className="h-3.5 w-3.5" aria-hidden />} className="[&>span:last-child]:inline-flex [&>span:last-child]:items-center [&>span:last-child]:gap-1.5" data-testid="claim-narrow">
                {m.ml_claim_narrow} <Keycap>N</Keycap>
              </Button>
            </div>
          )}
          {/* Born empty and kept mounted: only its text follows a refusal. */}
          <span className="typo-body text-status-warning" role="status">{claim.notice}</span>
        </div>
      )}
    </DeckSection>
  );
}
