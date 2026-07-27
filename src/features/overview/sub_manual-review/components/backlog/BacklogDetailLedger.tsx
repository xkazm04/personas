// Backlog detail — the "ledger" layout, borrowed verbatim in structure from
// the Workspaces practice detail (PracticeDetailLedger): prose left, facts in a
// 260px margin rail, the decision docked at the rail's foot so it sits with the
// facts it depends on.
//
// The two review surfaces are the same human act on different corpora, so they
// read the same. This file owns LAYOUT only — the state machine (verdicts,
// busy, queue stepping, keyboard) lives in BacklogDetailModal.
import { Check, ChevronLeft, ChevronRight, Hammer, X } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { DecisionActions } from '@/features/shared/components/decisions/DecisionActions';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { CATEGORY_TW, DEFAULT_CATEGORY_TW } from '@/features/plugins/dev-tools/constants/ideaColors';
import { LevelBadge } from '@/features/plugins/dev-tools/sub_scanner/IdeaScannerCards';
import { FindingBadge, VerdictChip } from '@/features/plugins/dev-tools/sub_triage/findings/FindingBadge';
import { useTranslation } from '@/i18n/useTranslation';

import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';

import { prettyEvidence, triageValueScore, type BacklogIdea } from './backlogModel';

/** Position within the review queue, plus the stepper. */
export interface BacklogNav {
  index: number;
  total: number;
  onStep: (delta: -1 | 1) => void;
}

/** One row of the margin rail — label above, value below, normal weight. */
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-2 min-w-0">
      <span className="typo-label text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="typo-body text-foreground break-words">{children}</span>
    </div>
  );
}

export function BacklogDetailLedger({
  idea,
  categoryLabel,
  busy,
  pending,
  onAccept,
  onReject,
  onBuildNow,
  onClose,
  nav,
}: {
  idea: BacklogIdea;
  categoryLabel: (key: string) => string;
  busy: boolean;
  /** Only a pending idea offers verdicts. */
  pending: boolean;
  onAccept: () => void;
  onReject: () => void;
  onBuildNow: () => void;
  onClose: () => void;
  nav?: BacklogNav;
}) {
  const { t, tx } = useTranslation();
  const r = t.overview.review;
  const tw = CATEGORY_TW[idea.category] ?? DEFAULT_CATEGORY_TW;
  const evidence = prettyEvidence(idea.evidence);

  return (
    <div className="flex flex-col max-h-[80vh]">
      <header className="flex items-start gap-3 px-6 pt-5 pb-4 border-b border-primary/10">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className={`typo-label px-1.5 py-0.5 rounded border ${tw.bg} ${tw.text} ${tw.border}`}>
              {categoryLabel(idea.category)}
            </span>
            {idea.origin && <FindingBadge origin={idea.origin} evidence={idea.evidence} />}
            <VerdictChip verifyState={idea.verifyState} />
          </div>
          <h2 id="backlog-detail" className="typo-title-lg text-foreground max-w-[68ch]">
            {idea.title}
          </h2>
        </div>

        {nav && nav.total > 1 && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => nav.onStep(-1)}
              disabled={busy || nav.index === 0}
              aria-label={r.backlog_detail_prev}
              title={r.backlog_detail_prev}
              className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="typo-caption text-muted-foreground tabular-nums whitespace-nowrap">
              {tx(r.backlog_detail_position, { index: nav.index + 1, total: nav.total })}
            </span>
            <button
              type="button"
              onClick={() => nav.onStep(1)}
              disabled={busy || nav.index >= nav.total - 1}
              aria-label={r.backlog_detail_next}
              title={r.backlog_detail_next}
              className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-secondary/40 disabled:opacity-30 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="flex flex-col md:flex-row md:divide-x divide-primary/10">
          {/* ARGUMENT COLUMN — prose. No key/value pairs live here.
              Readability rules (mirrors PracticeDetailLedger + Design.md):
              body copy is capped at a ~68ch measure (unbounded lines are the
              main reason long descriptions read badly at modal width), the
              lead keeps typo-body-lg/1.7, reasoning renders as markdown (the
              scanners emit lists and backticks) at full body contrast, and
              evidence wraps in place instead of scrolling sideways. */}
          <div className="md:flex-1 min-w-0 px-6 py-5 flex flex-col gap-5">
            <p className="typo-body-lg text-foreground leading-relaxed whitespace-pre-wrap max-w-[68ch] border-l-2 border-primary/30 pl-4">
              {idea.description || r.backlog_no_description}
            </p>
            {idea.reasoning.trim() && (
              <div className="flex flex-col gap-1.5 max-w-[68ch]">
                <span className="typo-label text-muted-foreground uppercase tracking-wide">
                  {r.backlog_detail_reasoning}
                </span>
                <MarkdownRenderer
                  content={idea.reasoning}
                  className="typo-body text-foreground/90 leading-relaxed"
                />
              </div>
            )}
            {evidence && (
              <div className="flex flex-col gap-1.5 max-w-[68ch]">
                <span className="typo-label text-muted-foreground uppercase tracking-wide">
                  {r.backlog_detail_evidence}
                </span>
                <pre className="typo-caption text-foreground/70 bg-secondary/30 rounded-card p-3 whitespace-pre-wrap break-words">
                  {evidence}
                </pre>
              </div>
            )}
          </div>

          {/* MARGIN RAIL — the only card. Facts, then the decision that uses them. */}
          <aside className="md:w-[260px] shrink-0 px-5 py-3 bg-secondary/20 flex flex-col">
            <div className="divide-y divide-primary/10">
              <Row label={r.backlog_detail_project}>
                {idea.projectName || r.backlog_project_none}
              </Row>
              <Row label={r.backlog_col_category}>{categoryLabel(idea.category)}</Row>
              <Row label={r.backlog_detail_origin}>
                {idea.origin
                  ? <FindingBadge origin={idea.origin} evidence={idea.evidence} />
                  : r.backlog_origin_scanner}
              </Row>
              <Row label={r.backlog_detail_levels}>
                <span className="flex flex-wrap gap-1">
                  <LevelBadge label={r.backlog_effort} value={idea.effort} />
                  <LevelBadge label={r.backlog_impact} value={idea.impact} />
                  <LevelBadge label={r.backlog_risk} value={idea.risk} />
                </span>
              </Row>
              <Row label={r.backlog_col_value}>
                <span className="tabular-nums">{triageValueScore(idea)}</span>
              </Row>
              <Row label={r.backlog_col_created}>
                <RelativeTime timestamp={idea.createdAt} />
              </Row>
            </div>

            {pending && (
              <div className="mt-4 pt-3 border-t border-primary/10 flex flex-col gap-2">
                <DecisionActions
                  layout="stacked"
                  size="md"
                  actions={[
                    { id: 'accept', label: r.backlog_accept, tone: 'accept', icon: <Check className="w-4 h-4" />, disabled: busy, onClick: onAccept },
                    { id: 'reject', label: r.backlog_reject, tone: 'reject', icon: <X className="w-4 h-4" />, disabled: busy, onClick: onReject },
                    { id: 'build', label: r.backlog_build_now, tone: 'neutral', icon: <Hammer className="w-4 h-4" />, disabled: busy, title: r.backlog_build_now_title, onClick: onBuildNow },
                  ]}
                />
              </div>
            )}
          </aside>
        </div>
      </div>

      <footer className="flex items-center gap-2 px-6 py-3 border-t border-primary/10">
        <span className="typo-caption text-muted-foreground hidden md:inline whitespace-nowrap">
          {r.backlog_detail_nav_hint}
        </span>
        <Button variant="ghost" onClick={onClose} className="ml-auto whitespace-nowrap">
          {t.common.close}
        </Button>
      </footer>
    </div>
  );
}
