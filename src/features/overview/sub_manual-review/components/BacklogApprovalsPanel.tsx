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
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
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
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <ListSkeleton rows={6} rowHeight={72} />
      </div>
    );
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
