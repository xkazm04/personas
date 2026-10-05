// The blocks you CONSULT rather than act in: what this goal waits on, which
// teams are attached, and what has happened to it.
//
// In the old single column these three sat behind one collapsed "More details"
// card at the very bottom, which is the only place they could go when
// everything shares one 800px column. Given width they become a rail - visible
// without being loud - and that is most of what the Ledger and Dossier variants
// are for.
import { Activity, GitMerge, Users } from 'lucide-react';

import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Button } from '@/features/shared/components/buttons';
import { tokenLabel } from '@/i18n/tokenMaps';

import { useGoalDetailModel } from '../context';
import { DEP_BLOCKS, DEP_FOLLOWS } from '../useGoalDetail';
import { DepGroup, Section, TEAM_CHIP, type SectionTone } from '../parts';

/**
 * Dependencies + follow-ups. Always rendered, even with no rows, because the
 * add pickers are the only way to author a link.
 */
export function Dependencies({ tone = 'quiet' }: { tone?: SectionTone }) {
  const { dl, blocksDeps, followsDeps, goalById, candidates, addDep, removeDep } = useGoalDetailModel();
  return (
    <Section icon={GitMerge} label={dl.goal_detail_dependencies} tone={tone} flush>
      <div className="space-y-3">
        <DepGroup
          label={dl.goal_dep_depends_on}
          rows={blocksDeps}
          goalById={goalById}
          candidates={candidates}
          addPlaceholder={dl.goal_dep_add_depends_on}
          emptyLabel={dl.goal_dep_none}
          onAdd={(id) => void addDep(id, DEP_BLOCKS)}
          onRemove={(id) => void removeDep(id)}
        />
        <DepGroup
          label={dl.goal_dep_follows}
          rows={followsDeps}
          goalById={goalById}
          candidates={candidates}
          addPlaceholder={dl.goal_dep_add_follows}
          emptyLabel={dl.goal_dep_none}
          onAdd={(id) => void addDep(id, DEP_FOLLOWS)}
          onRemove={(id) => void removeDep(id)}
        />
      </div>
    </Section>
  );
}

export function LinkedTeams({ tone = 'quiet' }: { tone?: SectionTone }) {
  const { dl, t, assignments, unlinkTeam } = useGoalDetailModel();
  if (assignments.length === 0) return null;
  return (
    <Section icon={Users} label={dl.goal_detail_linked_teams} tone={tone}>
      <ul className="space-y-1.5">
        {assignments.map((asgn) => (
          <li key={asgn.id} className="group flex items-center gap-2.5 typo-body">
            <span className={`typo-caption px-1.5 py-0.5 rounded-full border ${TEAM_CHIP}`}>
              {tokenLabel(t, 'execution', asgn.status)}
            </span>
            <span className="flex-1 text-foreground truncate">{asgn.title}</span>
            <Button
              variant="link"
              size="xs"
              onClick={() => void unlinkTeam(asgn.id)}
              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:text-status-error"
            >
              {dl.goal_unlink_team}
            </Button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function ActivityFeed({ tone = 'quiet', limit = 12 }: { tone?: SectionTone; limit?: number }) {
  const { dl, signals } = useGoalDetailModel();
  if (signals.length === 0) return null;
  return (
    <Section icon={Activity} label={dl.goal_detail_activity} tone={tone}>
      <ul className="space-y-1.5">
        {signals.slice(0, limit).map((sig) => (
          <li key={sig.id} className="flex items-start gap-2 typo-caption text-foreground">
            <span className="w-1.5 h-1.5 mt-1.5 rounded-full bg-primary/60 shrink-0" />
            <span className="text-foreground line-clamp-2 min-w-0 flex-1">
              {readableSignal(sig.message) ?? sig.signal_type}
            </span>
            <RelativeTime timestamp={sig.created_at} className="ml-auto text-foreground shrink-0" />
          </li>
        ))}
      </ul>
    </Section>
  );
}

/**
 * Signal messages arrive as prose, or as a JSON envelope the orchestrator
 * wrote. Pull the human sentence out of the envelope; fall back to stripping
 * the JSON-ish chunks and keeping whatever prose remains.
 */
export function readableSignal(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('{')) return trimmed;
  const grab = (key: string): string | null => {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(trimmed);
    if (!m?.[1]) return null;
    try {
      return JSON.parse(`"${m[1]}"`) as string;
    } catch {
      return m[1];
    }
  };
  const fromSummary = grab('summary');
  if (fromSummary) return fromSummary;
  const fromAction = grab('action');
  if (fromAction) return fromAction;
  const stripped = trimmed
    .replace(/\{"[\s\S]*?\}\}/g, ' ')
    .replace(/\{"[\s\S]*$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stripped.length > 12 ? stripped : null;
}
