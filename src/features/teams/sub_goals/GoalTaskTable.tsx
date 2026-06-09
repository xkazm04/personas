/**
 * GoalTaskTable — the goal's work as ONE table, merging the two surfaces that
 * used to overlap:
 *
 *  - **ad-hoc to-dos** (`dev_goal_items`) — user-managed, a toggleable checkbox;
 *  - **team-assignment steps** (`team_assignment_steps`) — what the AI team is
 *    doing, with the responsible persona, a read-only status, an expandable
 *    output, and (when `awaiting_review`) inline skip/abort intervention.
 *
 * The backend mirrors a decomposed goal's steps into `dev_goal_items` by **exact
 * title** (goal_advance.rs → apply_resolved_goal_progress), so the same work
 * showed up twice. Here we de-dupe by title — the richer team-step row wins —
 * so each unit of work is a single row.
 */
import { useMemo, useState } from 'react';
import {
  Circle, CheckCircle2, AlertCircle, XCircle, Clock, Loader2,
  Trash2, SkipForward, Ban, ChevronRight, ChevronDown,
} from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';
import type { Persona } from '@/lib/bindings/Persona';

interface Props {
  steps: TeamAssignmentStep[];
  items: DevGoalItem[];
  /** persona id → persona, for the Owner cell on team-step rows. */
  personaById: Map<string, Persona>;
  onToggleItem: (item: DevGoalItem) => void;
  onDeleteItem: (id: string) => void;
  onResolveStep: (stepId: string, action: 'skip' | 'abort') => void;
}

const GRID = 'grid grid-cols-[1.25rem_1fr_auto_auto] gap-2 items-center';

/**
 * Partition a goal's work into the table's two row kinds, de-duping the overlap.
 * The backend mirrors a decomposed goal's steps into `dev_goal_items` by EXACT
 * title (goal_advance.rs), so a to-do whose title matches a team step is the
 * same unit of work — the richer team-step row wins and the mirror is dropped.
 * Pure + exported for unit coverage.
 */
export function partitionGoalTasks(
  steps: TeamAssignmentStep[],
  items: DevGoalItem[],
): { orderedSteps: TeamAssignmentStep[]; adhoc: DevGoalItem[] } {
  const stepTitles = new Set(steps.map((s) => s.title));
  const adhoc = items.filter((i) => !stepTitles.has(i.title));
  const orderedSteps = [...steps].sort((a, b) => a.stepOrder - b.stepOrder);
  return { orderedSteps, adhoc };
}

function stepIsDone(status: string) {
  return status === 'done' || status === 'skipped';
}

/** Status → icon + tint for a team-step row (the read-only "state" cell). */
function stepVisual(status: string): { Icon: typeof Circle; tint: string; spin?: boolean } {
  if (stepIsDone(status)) return { Icon: CheckCircle2, tint: 'text-emerald-400' };
  if (status === 'awaiting_review') return { Icon: AlertCircle, tint: 'text-amber-400' };
  if (status === 'failed') return { Icon: XCircle, tint: 'text-red-400' };
  if (status === 'running') return { Icon: Loader2, tint: 'text-amber-400', spin: true };
  return { Icon: Clock, tint: 'text-foreground/50' }; // pending / queued / matching
}

export function GoalTaskTable({ steps, items, personaById, onToggleItem, onDeleteItem, onResolveStep }: Props) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;

  const { orderedSteps, adhoc } = useMemo(() => partitionGoalTasks(steps, items), [steps, items]);

  if (orderedSteps.length === 0 && adhoc.length === 0) {
    return <p className="typo-caption text-foreground/60 italic px-1 py-2">{dl.goal_tasks_empty}</p>;
  }

  return (
    <div className="rounded-card border border-primary/10 overflow-hidden">
      {/* Column header */}
      <div className={`${GRID} px-2.5 py-1.5 border-b border-primary/10 bg-primary/5`}>
        <span aria-hidden />
        <span className="typo-caption uppercase tracking-wider text-foreground/60">{dl.goal_tasks_col_task}</span>
        <span className="typo-caption uppercase tracking-wider text-foreground/60 justify-self-end">{dl.goal_tasks_col_owner}</span>
        <span aria-hidden className="w-12" />
      </div>

      <ul>
        {orderedSteps.map((step) => (
          <StepRow
            key={step.id}
            step={step}
            persona={step.assignedPersonaId ? personaById.get(step.assignedPersonaId) ?? null : null}
            statusLabel={tokenLabel(t, 'execution', step.status)}
            skipLabel={dl.goal_intervene_skip}
            abortLabel={dl.goal_intervene_abort}
            onResolve={onResolveStep}
          />
        ))}
        {adhoc.map((item) => (
          <AdhocRow
            key={item.id}
            item={item}
            youLabel={dl.goal_tasks_owner_you}
            markDone={dl.goal_item_mark_done}
            markUndone={dl.goal_item_mark_undone}
            deleteLabel={t.common.delete}
            onToggle={onToggleItem}
            onDelete={onDeleteItem}
          />
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

function OwnerCell({ persona, fallback }: { persona: Persona | null; fallback: string }) {
  if (!persona) {
    return <span className="justify-self-end typo-caption text-foreground/40">{fallback}</span>;
  }
  return (
    <span
      className="justify-self-end inline-flex items-center gap-1 max-w-[120px] typo-caption text-foreground"
      title={persona.name}
    >
      <span
        className="w-1.5 h-1.5 rounded-full shrink-0"
        style={{ backgroundColor: persona.color ?? 'rgb(var(--color-primary))' }}
        aria-hidden
      />
      <span className="truncate">{persona.name}</span>
    </span>
  );
}

function StepRow({
  step, persona, statusLabel, skipLabel, abortLabel, onResolve,
}: {
  step: TeamAssignmentStep;
  persona: Persona | null;
  statusLabel: string;
  skipLabel: string;
  abortLabel: string;
  onResolve: (stepId: string, action: 'skip' | 'abort') => void;
}) {
  const [open, setOpen] = useState(false);
  const awaiting = step.status === 'awaiting_review';
  const output = step.outputSummary?.trim();
  const hasOutput = !!output;
  const { Icon, tint, spin } = stepVisual(step.status);

  return (
    <li className="border-b border-primary/5 last:border-b-0">
      <div className={`${GRID} px-2.5 py-2`}>
        <Icon className={`w-4 h-4 shrink-0 ${tint} ${spin ? 'animate-spin' : ''}`} aria-label={statusLabel} />
        <button
          type="button"
          onClick={() => hasOutput && setOpen((v) => !v)}
          className={`min-w-0 flex items-center gap-1.5 text-left typo-body text-foreground ${hasOutput ? '' : 'cursor-default'}`}
          aria-expanded={hasOutput ? open : undefined}
        >
          {hasOutput && (open
            ? <ChevronDown className="w-3.5 h-3.5 shrink-0 text-foreground/60" />
            : <ChevronRight className="w-3.5 h-3.5 shrink-0 text-foreground/60" />)}
          <span className="truncate">{step.title}</span>
        </button>
        <OwnerCell persona={persona} fallback="—" />
        {awaiting ? (
          <span className="flex items-center gap-0.5 shrink-0 w-12 justify-end">
            <Button variant="ghost" size="icon-sm" title={skipLabel} onClick={() => onResolve(step.id, 'skip')}>
              <SkipForward className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon-sm" title={abortLabel} onClick={() => onResolve(step.id, 'abort')}>
              <Ban className="w-3.5 h-3.5 text-red-400" />
            </Button>
          </span>
        ) : (
          <span className="shrink-0 w-12 text-right typo-caption uppercase tracking-wide text-foreground/60 truncate" title={statusLabel}>
            {statusLabel}
          </span>
        )}
      </div>
      {open && hasOutput && (
        <div className="border-t border-primary/10 bg-card/20 px-3 py-2 max-h-72 overflow-y-auto">
          <MarkdownRenderer content={output} className="typo-caption leading-relaxed" />
        </div>
      )}
    </li>
  );
}

function AdhocRow({
  item, youLabel, markDone, markUndone, deleteLabel, onToggle, onDelete,
}: {
  item: DevGoalItem;
  youLabel: string;
  markDone: string;
  markUndone: string;
  deleteLabel: string;
  onToggle: (item: DevGoalItem) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <li className="group border-b border-primary/5 last:border-b-0">
      <div className={`${GRID} px-2.5 py-2`}>
        <button
          type="button"
          onClick={() => onToggle(item)}
          className="shrink-0"
          aria-label={item.done ? markUndone : markDone}
        >
          {item.done
            ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            : <Circle className="w-4 h-4 text-foreground/40 hover:text-foreground/70 transition-colors" />}
        </button>
        <span className={`min-w-0 truncate typo-body ${item.done ? 'text-foreground/40 line-through' : 'text-foreground'}`}>
          {item.title}
        </span>
        <span className="justify-self-end typo-caption text-foreground/40">{youLabel}</span>
        <span className="shrink-0 w-12 flex justify-end">
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-foreground/60 hover:text-red-400"
            aria-label={deleteLabel}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </span>
      </div>
    </li>
  );
}
