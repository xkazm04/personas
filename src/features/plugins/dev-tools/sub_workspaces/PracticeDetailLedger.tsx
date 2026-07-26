// "Ledger" — the record-with-margin layout, /prototype round-1 winner, borrowed
// from Manual Review's focus card (sub_manual-review/FocusedDecisionCard.tsx).
//
// It solves the readability complaint by SEPARATION OF KIND: prose lives left,
// facts live right, and a single vertical divider does the work a dozen little
// borders were doing. Nothing in the reading column is a key/value pair, so the
// claim and its evidence never compete with metadata.
//
//   • the argument column reads like a document: accent-barred lede, then
//     evidence prose — no boxes at all;
//   • the margin rail is the only card, a divide-y stack of label-over-value
//     rows, plus the governance actions docked at its foot so the decision
//     sits with the facts it depends on;
//   • verdict affordances follow Manual Review's overlay-button language
//     (colour-on-hover, ring when active) rather than generic footer buttons.
import { Check, X, Ban, Share2, ChevronLeft, ChevronRight } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { DecisionActions } from '@/features/shared/components/decisions/DecisionActions';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';

import { KnowledgeStatusChip } from './centerShared';
import { areaTheme } from './practiceAreaTheme';
import type { PracticeViewProps } from './practiceViewTypes';

/** One row of the margin rail — label above, value below, normal weight. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 min-w-0">
      <span className="typo-label text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="typo-body text-foreground break-words">{children}</span>
    </div>
  );
}

export function PracticeDetailLedger({
  practice,
  originLabel,
  actorLabel,
  busy,
  pending,
  adopted,
  onDecide,
  onRollout,
  onClose,
  nav,
}: PracticeViewProps) {
  const { t, tx } = useTranslation();
  const tw = t.plugins.dev_tools.workspaces;
  const theme = areaTheme(practice.topic);

  return (
    <div className="flex flex-col max-h-[80vh]">
      <header className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-primary/10">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            {practice.topic && (
              <span className={`typo-label px-1.5 py-0.5 rounded ${theme.chip}`}>
                {practice.topic}
              </span>
            )}
            <KnowledgeStatusChip status={practice.status} />
            <span className="typo-caption text-muted-foreground">{practice.kind}</span>
          </div>
          <h2 id="practice-detail" className="typo-title text-foreground">
            {practice.title}
          </h2>
        </div>

        {nav && nav.total > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => nav.onStep(-1)}
              disabled={busy || nav.index === 0}
              aria-label={tw.detail_prev}
              title={tw.detail_prev}
              className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="typo-caption text-muted-foreground tabular-nums whitespace-nowrap">
              {tx(tw.detail_position, { index: nav.index + 1, total: nav.total })}
            </span>
            <button
              type="button"
              onClick={() => nav.onStep(1)}
              disabled={busy || nav.index >= nav.total - 1}
              aria-label={tw.detail_next}
              title={tw.detail_next}
              className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col md:flex-row md:divide-x divide-primary/10">
          {/* ARGUMENT COLUMN — pure prose, no key/value pairs, no boxes. */}
          <div className="md:flex-1 min-w-0 px-6 py-5 flex flex-col gap-4">
            <p className={`typo-body-lg text-foreground leading-relaxed border-l-2 pl-4 ${theme.rail}`}>
              {practice.statement}
            </p>
            {practice.detail_md?.trim() && (
              <div className="flex flex-col gap-2">
                <span className="typo-label text-muted-foreground uppercase tracking-wide">
                  {tw.detail_evidence}
                </span>
                <MarkdownRenderer
                  content={practice.detail_md}
                  className="typo-body text-muted-foreground leading-relaxed"
                />
              </div>
            )}
          </div>

          {/* MARGIN RAIL — the only card. Facts, then the decision that uses them. */}
          <aside className="md:w-[260px] shrink-0 px-5 py-3 bg-secondary/20 flex flex-col">
            <div className="divide-y divide-primary/10">
              <Row label={tw.col_origin}>{originLabel}</Row>
              <Row label={tw.col_altitude}>
                {practice.abstraction ?? '—'}
                {practice.ftype ? ` · ${practice.ftype}` : ''}
              </Row>
              <Row label={tw.detail_durability}>{practice.durability ?? '—'}</Row>
              <Row label={tw.col_confidence}>
                {practice.confidence == null ? '—' : `${Math.round(practice.confidence * 100)}%`}
              </Row>
              <Row label={tw.detail_source}>{actorLabel ?? '—'}</Row>
              <Row label={tw.col_updated}>
                <RelativeTime timestamp={practice.updated_at} />
              </Row>
              {practice.decided_at && (
                <Row label={tw.detail_decided}>
                  <RelativeTime timestamp={practice.decided_at} />
                </Row>
              )}
              {practice.evidence_count != null && practice.evidence_count > 1 && (
                <Row label={tw.detail_evidence}>
                  {tx(tw.detail_evidence_count, { count: practice.evidence_count })}
                </Row>
              )}
            </div>

            {(pending || adopted) && (
              <div className="mt-4 pt-3 border-t border-primary/10 flex flex-col gap-2">
                {/* Same control the backlog and the review queue use — adopt is
                    an `accept`, reject is a `reject`, and the tones come from
                    one place so the three streams can't drift. */}
                <DecisionActions
                  layout="stacked"
                  size="md"
                  actions={
                    pending
                      ? [
                          { id: 'adopt', label: tw.decide_adopt, tone: 'accept', icon: <Check className="w-4 h-4" />, disabled: busy, onClick: () => onDecide('adopt') },
                          { id: 'reject', label: tw.decide_reject, tone: 'reject', icon: <X className="w-4 h-4" />, disabled: busy, onClick: () => onDecide('reject') },
                        ]
                      : [
                          ...(onRollout
                            ? [{ id: 'rollout', label: tw.rollout_dispatch, tone: 'accept' as const, icon: <Share2 className="w-4 h-4" />, disabled: busy, onClick: onRollout }]
                            : []),
                          { id: 'deprecate', label: tw.decide_deprecate, tone: 'neutral', icon: <Ban className="w-4 h-4" />, disabled: busy, onClick: () => onDecide('deprecate') },
                        ]
                  }
                />
                {pending && (
                  <p className="typo-caption text-muted-foreground">{tw.decide_reject_hint}</p>
                )}
              </div>
            )}
          </aside>
        </div>
      </div>

      <footer className="flex items-center gap-2 px-6 py-3 border-t border-primary/10">
        {nav && nav.total > 1 && (
          <span className="typo-caption text-muted-foreground hidden md:inline whitespace-nowrap">
            {tw.detail_nav_hint}
          </span>
        )}
        <Button variant="ghost" onClick={onClose} className="ml-auto whitespace-nowrap">
          {t.common.close}
        </Button>
      </footer>
    </div>
  );
}
