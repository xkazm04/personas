// Dev Tools backlog as a mode of the Approvals decision center.
//
// Renders through the SHARED decision primitives (DecisionRow + DecisionActions)
// rather than its own row and its own accept/reject pair. All this file now
// owns is the adapter from `DevIdea` to `DecisionRecord` — the presentation is
// the same one Manual Review and the knowledge library use, so the three
// streams can no longer drift apart.
import { ScanSearch, Check, X } from 'lucide-react';

import { DecisionRow } from '@/features/shared/components/decisions/DecisionRow';
import type { DecisionRecord } from '@/features/shared/components/decisions/decisionTypes';
import { IllustrationEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevIdea } from '@/lib/bindings/DevIdea';

export function BacklogApprovalsPanel({
  ideas,
  loading,
  acting,
  projectName,
  onAct,
}: {
  ideas: DevIdea[];
  loading: boolean;
  acting: string | null;
  projectName: Map<string, string>;
  onAct: (idea: DevIdea, accept: boolean) => void;
}) {
  const { t } = useTranslation();
  const r = t.overview.review;

  if (loading && ideas.length === 0) {
    return <BacklogGhostRows />;
  }

  if (ideas.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <IllustrationEmptyState
          motif="approval"
          content={{
            icon: ScanSearch,
            title: r.backlog_empty_title,
            subtitle: r.backlog_empty_subtitle,
          }}
        />
      </div>
    );
  }

  /** DevIdea → the shared decision shape. Effort/impact/risk become labelled
   *  facts instead of being strung into the subtitle as "· E3 I5 R2". */
  const toRecord = (idea: DevIdea): DecisionRecord => ({
    id: idea.id,
    title: idea.title,
    summary: idea.description,
    category: idea.category,
    source: (idea.project_id && projectName.get(idea.project_id)) || undefined,
    timestamp: idea.created_at,
    facts: [
      ...(idea.effort != null ? [{ label: r.backlog_effort, value: idea.effort, title: r.backlog_effort_title }] : []),
      ...(idea.impact != null ? [{ label: r.backlog_impact, value: idea.impact, title: r.backlog_impact_title }] : []),
      ...(idea.risk != null ? [{ label: r.backlog_risk, value: idea.risk, title: r.backlog_risk_title }] : []),
    ],
  });

  return (
    <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-primary/[0.06]">
      {ideas.map((idea) => (
        <DecisionRow
          key={idea.id}
          record={toRecord(idea)}
          actions={[
            {
              id: 'accept',
              label: r.backlog_accept,
              tone: 'accept',
              icon: <Check className="w-3.5 h-3.5" />,
              loading: acting === idea.id,
              onClick: () => onAct(idea, true),
            },
            {
              id: 'reject',
              label: r.backlog_reject,
              tone: 'reject',
              icon: <X className="w-3.5 h-3.5" />,
              disabled: acting === idea.id,
              onClick: () => onAct(idea, false),
            },
          ]}
        />
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// BacklogGhostRows — calm, delayed ghost rows matching the DecisionRow
// geometry (title + summary + fact chips + accept/reject actions) for the
// only moment the backlog body has nothing to show while a fetch is in
// flight (docs/design/overview-loading.md). No `animate-pulse`; each row
// enters via `animate-fade-in` behind a >=120ms staggered delay so a fast
// fetch never paints one.
// ---------------------------------------------------------------------------

const BACKLOG_GHOST_BAR = 'rounded bg-primary/[0.06]';
const BACKLOG_GHOST_TITLE_WIDTHS = ['w-48', 'w-36', 'w-44', 'w-40'];

function BacklogGhostRows() {
  return (
    <ul className="flex-1 min-h-0 overflow-hidden" aria-hidden="true">
      {Array.from({ length: 6 }).map((_, i) => {
        const titleW = BACKLOG_GHOST_TITLE_WIDTHS[i % BACKLOG_GHOST_TITLE_WIDTHS.length];
        const delay = `${120 + i * 35}ms`;
        return (
          <li
            key={i}
            className="flex items-start gap-3 px-4 py-3 border-l-2 border-l-transparent border-b border-primary/[0.06] animate-fade-in"
            style={{ minHeight: 72, animationDelay: delay }}
          >
            <div className="min-w-0 flex-1 space-y-1.5">
              <span className={`block h-3.5 ${titleW} max-w-full ${BACKLOG_GHOST_BAR}`} />
              <span className={`block h-2.5 w-2/3 max-w-[260px] ${BACKLOG_GHOST_BAR}`} />
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-10 ${BACKLOG_GHOST_BAR}`} />
                <span className={`h-2.5 w-10 ${BACKLOG_GHOST_BAR}`} />
                <span className={`h-2.5 w-10 ${BACKLOG_GHOST_BAR}`} />
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
              <span className="h-6 w-16 rounded-card bg-primary/[0.06]" />
              <span className="h-6 w-16 rounded-card bg-primary/[0.06]" />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
