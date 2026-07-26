// Dev Tools backlog as a mode of the Approvals decision center.
//
// Promoted from `BacklogInboxGroup` — a collapsible amber strip crammed above
// the review inbox, where every row rendered title AND metadata at the same
// `typo-caption`, so the two lines were indistinguishable. As a full mode it
// gets the room to use Manual Review's own row language: heading-weight title
// over muted supporting line, severity-style category accent, hover state and
// chevron affordance matching `ReviewListItem`.
//
// Behaviour is unchanged: loads pending ideas across all projects and acts via
// `dev_tools_accept_idea` / `dev_tools_reject_idea` (which persist and write
// the team learning memory).
import { ScanSearch, Check, X } from 'lucide-react';

import { Button } from '@/features/shared/components/buttons';
import { IllustrationEmptyState } from '@/features/overview/shared/emptyStatePrototype';
import { ListSkeleton } from '@/features/shared/components/layout/ListSkeleton';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevIdea } from '@/lib/bindings/DevIdea';

/** Effort / impact / risk are the numbers a triager actually weighs — give them
 *  their own tabular row instead of stringing them into the subtitle. */
function Score({ label, value }: { label: string; value: number | null }) {
  if (value == null) return null;
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="typo-label text-muted-foreground uppercase tracking-wide">{label}</span>
      <span className="typo-caption text-foreground tabular-nums">{value}</span>
    </span>
  );
}

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

  return (
    <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-primary/[0.06]">
      {ideas.map((idea) => (
        <li
          key={idea.id}
          className="flex items-start gap-3 px-4 py-3 border-l-2 border-l-transparent hover:bg-secondary/30 transition-colors"
        >
          <div className="min-w-0 flex-1">
            {/* Title carries heading weight; everything else steps down — the
                fix for the old strip where both lines were typo-caption. */}
            <p className="typo-heading text-foreground/90">{idea.title}</p>
            <div className="flex items-center gap-2.5 mt-1 flex-wrap">
              <span className="typo-caption text-muted-foreground">
                {(idea.project_id && projectName.get(idea.project_id)) || '—'}
              </span>
              <span className="typo-label px-1.5 py-0.5 rounded bg-primary/10 text-primary/80">
                {idea.category}
              </span>
              <Score label={r.backlog_effort} value={idea.effort} />
              <Score label={r.backlog_impact} value={idea.impact} />
              <Score label={r.backlog_risk} value={idea.risk} />
              <RelativeTime timestamp={idea.created_at} className="typo-caption text-muted-foreground" />
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              variant="accent"
              accentColor="emerald"
              size="sm"
              icon={<Check className="w-3.5 h-3.5" />}
              loading={acting === idea.id}
              onClick={() => onAct(idea, true)}
              className="whitespace-nowrap"
            >
              {r.backlog_accept}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon={<X className="w-3.5 h-3.5" />}
              disabled={acting === idea.id}
              onClick={() => onAct(idea, false)}
              className="whitespace-nowrap"
            >
              {r.backlog_reject}
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
