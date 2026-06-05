import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Loader2, AlertCircle, CheckCircle2, Ban, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { KanbanBoard, type KanbanColumn } from '@/features/shared/components/kanban/KanbanBoard';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button } from '@/features/shared/components/buttons';
import type { TeamAssignment } from '@/lib/bindings/TeamAssignment';
import {
  StepProgressStrip, StepRelay, GoalChip, PersonaStack,
  usePersonaIndex, useAssignmentSteps, isLiveAssignmentStatus, useRefreshAssignments,
} from './boardShared';

const DRAG_MIME = 'application/x-personas-assignment-id';

/**
 * FLOW LANES variant — "work moves across the board".
 *
 * Metaphor: the baseline kanban evolved into an operational surface. Same
 * auto-flowing status lanes (the orchestrator owns the transitions; drag-to-
 * Stopped stays the one user move), but cards carry REAL signal instead of a
 * bare title: live step-progress strip, the personas doing the work, the goal
 * link, age and rework markers. Clicking a card opens a right drawer with the
 * full StepRelay (statuses, outputs, review intervention) — the lane overview
 * stays primary, depth is one click away. Differs from Flight Deck by keeping
 * the WHOLE fleet visible at all times instead of one mission in deep focus.
 */
export function TeamAssignmentBoardFlowLanes({ teamId }: { teamId: string }) {
  const { t } = useTranslation();
  const ts = t.pipeline.team_studio;
  const assignments = usePipelineStore((s) => s.assignmentsByTeam[teamId]) ?? [];
  const abortAssignment = usePipelineStore((s) => s.abortAssignment);
  const refreshAssignments = useRefreshAssignments(teamId);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    refreshAssignments();
  }, [refreshAssignments]);

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
      if (target === 'aborted') void abortAssignment(id);
    },
    [abortAssignment],
  );

  const open = assignments.find((a) => a.id === openId) ?? null;

  return (
    <div className="h-full flex flex-col gap-3" data-testid="board-flow-lanes">
      <span className="typo-label uppercase tracking-wider text-foreground/70">{ts.board_label}</span>
      {assignments.length === 0 ? (
        <p className="typo-body text-foreground/50 px-1">{ts.board_empty}</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <KanbanBoard<TeamAssignment>
            columns={columns}
            items={assignments}
            getItemId={(a) => a.id}
            getItemStatus={(a) => a.status}
            onItemMove={handleMove}
            dragMimeType={DRAG_MIME}
            orientation="rows"
            fallbackColumnId="queued"
            renderCard={(a) => <FlowCard assignment={a} onOpen={() => setOpenId(a.id)} />}
          />
        </div>
      )}

      {/* Drill-in drawer — the full step relay for one assignment */}
      <AssignmentDrawer
        assignment={open}
        onClose={() => setOpenId(null)}
        onChanged={refreshAssignments}
      />
    </div>
  );
}

function toIsoUtc(s: string): string {
  if (!s) return s;
  if (/[Zz]$/.test(s) || /[+-]\d{2}:?\d{2}$/.test(s)) return s;
  return `${s.replace(' ', 'T')}Z`;
}

function FlowCard({ assignment, onOpen }: { assignment: TeamAssignment; onOpen: () => void }) {
  const personaIndex = usePersonaIndex();
  const { steps } = useAssignmentSteps(assignment.id, isLiveAssignmentStatus(assignment.status));
  const reworkRounds = steps.reduce((acc, s) => acc + s.retryCount, 0);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-52 text-left rounded-card border border-primary/10 bg-background/60 p-2.5 hover:border-primary/30 hover:bg-background/80 transition-colors"
      data-testid="flow-card"
    >
      <div className="flex items-start justify-between gap-1.5">
        <h4 className="typo-card-label text-foreground line-clamp-2">
          {assignment.title.replace(/^Advance: /, '')}
        </h4>
        <GoalChip goalId={assignment.goalId} />
      </div>
      <StepProgressStrip steps={steps} className="mt-2" />
      <div className="mt-2 flex items-center justify-between gap-2">
        <PersonaStack ids={steps.map((s) => s.assignedPersonaId)} index={personaIndex} max={3} />
        <span className="typo-caption text-foreground/40 flex-shrink-0">
          <RelativeTime timestamp={toIsoUtc(assignment.createdAt)} />
        </span>
      </div>
      {reworkRounds > 0 && (
        <p className="mt-1.5 typo-caption text-amber-300/80">QA rework ×{reworkRounds}</p>
      )}
    </button>
  );
}

function AssignmentDrawer({
  assignment,
  onClose,
  onChanged,
}: {
  assignment: TeamAssignment | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const personaIndex = usePersonaIndex();
  const { steps, refresh } = useAssignmentSteps(
    assignment?.id ?? null,
    assignment ? isLiveAssignmentStatus(assignment.status) : false,
  );

  return (
    <BaseModal
      isOpen={!!assignment}
      onClose={onClose}
      titleId="assignment-drawer-title"
      placement="right-drawer"
      maxWidthClass="max-w-lg"
      panelClassName="bg-background border-l border-primary/10 shadow-elevation-4 h-full flex flex-col"
      staggerChildren={false}
    >
      {assignment && (
        <>
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-primary/10">
            <div className="min-w-0">
              <h2 id="assignment-drawer-title" className="typo-section-title text-foreground truncate">
                {assignment.title.replace(/^Advance: /, '')}
              </h2>
              <p className="typo-caption text-foreground/55">
                {assignment.status.replace('_', ' ')} · <RelativeTime timestamp={toIsoUtc(assignment.createdAt)} />
              </p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {steps.length > 0 ? (
              <StepRelay
                steps={steps}
                personaIndex={personaIndex}
                onIntervened={() => {
                  refresh();
                  onChanged();
                }}
              />
            ) : (
              <p className="typo-body text-foreground/45">Decomposing into steps…</p>
            )}
          </div>
        </>
      )}
    </BaseModal>
  );
}

export default TeamAssignmentBoardFlowLanes;
