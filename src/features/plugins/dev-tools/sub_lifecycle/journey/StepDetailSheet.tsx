/**
 * Detail layer for one journey step: name + phase, the rule the agent is
 * given, each binding with its state (same shape + colour as the node) and
 * what was found, the tally, and the evidence list (task / commit / pull
 * request marked) with this step's outcome. Esc and the close key dismiss it
 * (BaseModal right drawer).
 */
import { X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { LifecycleEvidenceItem } from '@/lib/bindings/LifecycleEvidenceItem';
import { BaseModal } from '@/lib/ui/BaseModal';

import type { JourneyNode } from './journeyModel';
import {
  bindingKindLabel, bindingStateLabel, outcomeLabel, sourceKindGlyph, sourceKindLabel, stepGlyph, stepLabel,
} from './journeyLabels';
import { OUTCOME_DOT, OUTCOME_TEXT, STATE_CHIP, STATE_TEXT, STATE_SHAPE } from './journeyStyles';

const TITLE_ID = 'lc-step-detail-title';

interface StepDetailSheetProps {
  node: JourneyNode;
  /** The snapshot's evidence window, newest first. */
  evidence: LifecycleEvidenceItem[];
  onClose: () => void;
}

export function StepDetailSheet({ node, evidence, onClose }: StepDetailSheetProps) {
  const { t, tx } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const Glyph = stepGlyph(node.id);
  const label = stepLabel(dl, node.id, node.label);

  return (
    <BaseModal isOpen onClose={onClose} titleId={TITLE_ID} placement="right-drawer" portal maxWidthClass="max-w-lg">
      <div className="flex h-full min-h-0 flex-col" data-testid="lc-step-detail">
        <header className="flex items-start gap-3 border-b border-primary/10 px-5 py-4">
          <span className={`w-10 h-10 rounded-card flex items-center justify-center shrink-0 ${STATE_SHAPE[node.strongestState]}`}>
            <Glyph className={`w-5 h-5 ${STATE_TEXT[node.strongestState]}`} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={TITLE_ID} className="typo-section-title text-foreground">{label}</h2>
            <p className="typo-caption text-foreground">
              {node.phase === 'before' ? dl.lc_lane_before : dl.lc_lane_after}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
            <X className="w-4 h-4" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <section className="space-y-1.5">
            <h3 className="typo-card-label text-foreground">{dl.lc_detail_rule}</h3>
            <p className="typo-body text-foreground leading-relaxed">{node.rule}</p>
          </section>

          <section className="space-y-2">
            <h3 className="typo-card-label text-foreground">{dl.lc_detail_bindings}</h3>
            <ul className="space-y-1.5">
              {node.view.bindingViews.map((b) => (
                <li key={b.kind} className="flex items-start gap-2.5 rounded-input border border-primary/10 px-3 py-2">
                  <span className={`mt-1 w-3 h-3 rounded-interactive shrink-0 ${STATE_CHIP[b.state]}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="typo-body text-foreground">
                      {bindingKindLabel(dl, b.kind)}
                      <span className={`ml-2 typo-caption ${STATE_TEXT[b.state]}`}>{bindingStateLabel(dl, b.state)}</span>
                    </p>
                    {b.detail && <p className="typo-caption text-foreground truncate">{b.detail}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="typo-card-label text-foreground">{dl.lc_detail_evidence}</h3>
            <p className="typo-caption text-foreground">
              {tx(dl.lc_detail_tally, {
                done: node.tally.done, skipped: node.tally.skipped, unknown: node.tally.unknown, failed: node.tally.failed,
              })}
            </p>
            {evidence.length === 0 ? (
              <p className="typo-body text-foreground">{dl.lc_detail_no_evidence}</p>
            ) : (
              <ul className="divide-y divide-primary/10 rounded-input border border-primary/10">
                {evidence.map((item) => {
                  const hit = item.outcomes.find((o) => o.stepId === node.id);
                  const outcome = hit?.outcome ?? 'unknown';
                  const SourceGlyph = sourceKindGlyph(item.sourceKind);
                  return (
                    <li key={`${item.sourceKind}:${item.sourceRef}`} className="flex items-start gap-2.5 px-3 py-2" data-testid="lc-evidence-row">
                      <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${OUTCOME_DOT[outcome]}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="typo-body text-foreground truncate">{item.title}</p>
                        <p className="typo-caption text-foreground flex items-center gap-1.5 flex-wrap">
                          <SourceGlyph className="w-3.5 h-3.5 shrink-0" aria-hidden />
                          <span>{sourceKindLabel(dl, item.sourceKind)}</span>
                          <RelativeTime timestamp={item.occurredAt} />
                          <span className={OUTCOME_TEXT[outcome]}>{outcomeLabel(dl, outcome)}</span>
                        </p>
                        {hit?.detail && <p className="typo-caption text-foreground">{hit.detail}</p>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </BaseModal>
  );
}
