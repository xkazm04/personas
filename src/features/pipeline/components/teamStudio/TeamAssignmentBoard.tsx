import { useEffect, useMemo, useCallback } from 'react';
import { Clock, Loader2, AlertCircle, CheckCircle2, Ban } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KanbanBoard, type KanbanColumn } from '@/features/shared/components/kanban/KanbanBoard';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';

const DRAG_MIME = 'application/x-personas-assignment-id';

/**
 * Lifecycle board for a team's assignments. Columns mirror the assignment
 * status the orchestrator owns (queued → running → needs-review → done, plus
 * a stopped lane), so cards **auto-flow** between columns as the background
 * orchestrator emits progress (kept fresh by the global progress listener).
 * The one user-driven transition is drag-to-Stopped, which aborts a running
 * or queued assignment. Other columns are display-only (status is not user
 * forced).
 */
export function TeamAssignmentBoard({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const assignments = usePipelineStore((s) => s.assignmentsByTeam[teamId]);
  const fetchList = usePipelineStore((s) => s.fetchTeamAssignments);
  const abortAssignment = usePipelineStore((s) => s.abortAssignment);

  useEffect(() => {
    void fetchList(teamId);
  }, [teamId, fetchList]);

  const columns: KanbanColumn[] = useMemo(
    () => [
      { id: 'queued', label: ts.board_col_queued, icon: Clock, iconColor: 'text-foreground/60', statuses: ['queued'] },
      { id: 'running', label: ts.board_col_running, icon: Loader2, iconColor: 'text-blue-400', borderColor: 'border-blue-500/25', bgColor: 'bg-blue-500/5', statuses: ['running'] },
      { id: 'review', label: ts.board_col_review, icon: AlertCircle, iconColor: 'text-amber-400', borderColor: 'border-amber-500/25', bgColor: 'bg-amber-500/5', statuses: ['awaiting_review'] },
      { id: 'done', label: ts.board_col_done, icon: CheckCircle2, iconColor: 'text-emerald-400', borderColor: 'border-emerald-500/25', bgColor: 'bg-emerald-500/5', statuses: ['done'] },
      { id: 'stopped', label: ts.board_col_stopped, icon: Ban, iconColor: 'text-red-400', borderColor: 'border-red-500/25', bgColor: 'bg-red-500/5', ringColor: 'ring-red-400/50', statuses: ['failed', 'aborted'], targetStatus: 'aborted' },
    ],
    [ts],
  );

  const handleMove = useCallback(
    (id: string, target: string) => {
      // The only user-driven transition: drag onto Stopped → abort.
      if (target === 'aborted') void abortAssignment(id);
    },
    [abortAssignment],
  );

  const list = assignments ?? [];

  return (
    <div className="h-full flex flex-col gap-3" data-testid="team-assignment-board">
      <span className="typo-label uppercase tracking-wider text-foreground/70">{ts.board_label}</span>
      {list.length === 0 ? (
        <p className="typo-body text-foreground/50 px-1">{ts.board_empty}</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <KanbanBoard<TeamAssignment>
            columns={columns}
            items={list}
            getItemId={(a) => a.id}
            getItemStatus={(a) => a.status}
            onItemMove={handleMove}
            dragMimeType={DRAG_MIME}
            columnsClassName="grid grid-cols-5 gap-3"
            fallbackColumnId="queued"
            renderCard={(a) => (
              <div className="rounded-modal border border-primary/10 bg-background/60 p-2.5" data-testid="team-assignment-card">
                <h4 className="typo-card-label line-clamp-2">{a.title}</h4>
                <div className="mt-2 text-[9px] text-foreground/50">
                  <RelativeTime timestamp={a.createdAt} />
                </div>
              </div>
            )}
          />
        </div>
      )}
    </div>
  );
}

export default TeamAssignmentBoard;
