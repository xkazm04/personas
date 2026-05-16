import { useMemo, useState, useCallback, type DragEvent } from 'react';
import { User, Bot, CheckCircle2, Clock, AlertCircle, Target, Minus, Plus } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { toastCatch } from '@/lib/silentCatch';
import type { DevGoal } from '@/lib/bindings/DevGoal';

// ---------------------------------------------------------------------------
// Lane definitions
// ---------------------------------------------------------------------------

type LaneLabelKey = 'your_turn' | 'agents_turn' | 'done';

interface Lane {
  id: string;
  labelKey: LaneLabelKey;
  icon: typeof User;
  iconColor: string;
  borderColor: string;
  bgColor: string;
  ringColor: string;
  statuses: string[];
  // Status assigned when a card is dropped into this lane.
  targetStatus: string;
}

const LANES: Lane[] = [
  {
    id: 'your_turn',
    labelKey: 'your_turn',
    icon: User,
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/25',
    bgColor: 'bg-amber-500/5',
    ringColor: 'ring-amber-400/50',
    statuses: ['review', 'pending', 'blocked'],
    targetStatus: 'pending',
  },
  {
    id: 'agent_turn',
    labelKey: 'agents_turn',
    icon: Bot,
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/25',
    bgColor: 'bg-blue-500/5',
    ringColor: 'ring-blue-400/50',
    statuses: ['in_progress', 'running'],
    targetStatus: 'in_progress',
  },
  {
    id: 'done',
    labelKey: 'done',
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/25',
    bgColor: 'bg-emerald-500/5',
    ringColor: 'ring-emerald-400/50',
    statuses: ['completed', 'done'],
    targetStatus: 'completed',
  },
];

const PROGRESS_STEP = 5;
const DRAG_MIME = 'application/x-personas-goal-id';

// ---------------------------------------------------------------------------
// Goal card
// ---------------------------------------------------------------------------

interface GoalCardProps {
  goal: DevGoal;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

function GoalCard({ goal, onDragStart, onDragEnd, isDragging }: GoalCardProps) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const updateGoal = useSystemStore((s) => s.updateGoal);
  const progressPct = goal.progress ?? 0;
  const [hovered, setHovered] = useState(false);

  const handleNudge = useCallback(async (delta: number) => {
    const next = Math.max(0, Math.min(100, progressPct + delta));
    if (next === progressPct) return;
    try {
      await updateGoal(goal.id, { progress: next });
    } catch (err) {
      toastCatch('Failed to update goal progress')(err);
    }
  }, [goal.id, progressPct, updateGoal]);

  const handleDragStart = (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(DRAG_MIME, goal.id);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(goal.id);
  };

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={[
        'rounded-modal border border-primary/10 bg-background/60 p-3 transition-all cursor-grab active:cursor-grabbing',
        isDragging ? 'opacity-40' : 'hover:border-primary/20',
      ].join(' ')}
    >
      <div className="flex items-start gap-2">
        <Target className="w-3.5 h-3.5 text-primary/60 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="typo-card-label truncate">{goal.title}</h4>
          {goal.description && (
            <p className="text-[11px] text-foreground mt-0.5 line-clamp-2">{goal.description}</p>
          )}
        </div>
      </div>

      {/* Progress bar + nudge buttons (buttons appear on hover) */}
      <div className="mt-2 flex items-center gap-1.5">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleNudge(-PROGRESS_STEP); }}
          disabled={progressPct <= 0}
          aria-label={dl.kanban_nudge_decrease}
          title={dl.kanban_nudge_decrease}
          className={[
            'shrink-0 w-4 h-4 rounded-full border border-primary/20 flex items-center justify-center transition-opacity',
            hovered && progressPct > 0 ? 'opacity-100 hover:bg-primary/10' : 'opacity-0 pointer-events-none',
          ].join(' ')}
        >
          <Minus className="w-2.5 h-2.5 text-foreground" />
        </button>
        <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary/50 rounded-full transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleNudge(PROGRESS_STEP); }}
          disabled={progressPct >= 100}
          aria-label={dl.kanban_nudge_increase}
          title={dl.kanban_nudge_increase}
          className={[
            'shrink-0 w-4 h-4 rounded-full border border-primary/20 flex items-center justify-center transition-opacity',
            hovered && progressPct < 100 ? 'opacity-100 hover:bg-primary/10' : 'opacity-0 pointer-events-none',
          ].join(' ')}
        >
          <Plus className="w-2.5 h-2.5 text-foreground" />
        </button>
        <span className="text-[9px] text-foreground w-7 text-right tabular-nums">{progressPct}%</span>
      </div>

      {/* Meta row */}
      <div className="flex items-center gap-2 mt-2">
        <StatusChip status={goal.status} />
        {goal.target_date && (
          <span className="text-[9px] text-foreground flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" />
            {goal.target_date}
          </span>
        )}
      </div>
    </div>
  );
}

const STATUS_CHIP_CLASSES: Record<string, string> = {
  pending: 'text-foreground border-primary/15 bg-primary/5',
  review: 'text-amber-400 border-amber-500/25 bg-amber-500/10',
  blocked: 'text-red-400 border-red-500/25 bg-red-500/10',
  in_progress: 'text-blue-400 border-blue-500/25 bg-blue-500/10',
  running: 'text-blue-400 border-blue-500/25 bg-blue-500/10',
  completed: 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10',
  done: 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10',
};

function StatusChip({ status }: { status: string }) {
  const { t } = useTranslation();
  const className = STATUS_CHIP_CLASSES[status] ?? 'text-foreground border-primary/15 bg-primary/5';
  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${className}`}>
      {tokenLabel(t, 'goal_state', status)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main kanban component
// ---------------------------------------------------------------------------

export default function GoalKanban() {
  const { t } = useTranslation();
  const dt = t.plugins.dev_tools;
  const goals = useSystemStore((s) => s.goals);
  const updateGoal = useSystemStore((s) => s.updateGoal);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetLaneId, setDropTargetLaneId] = useState<string | null>(null);

  const laneGoals = useMemo(() => {
    const map = new Map<string, DevGoal[]>();
    for (const lane of LANES) {
      map.set(lane.id, []);
    }
    for (const goal of goals) {
      const lane = LANES.find((l) => l.statuses.includes(goal.status));
      if (lane) {
        map.get(lane.id)!.push(goal);
      } else {
        // Default to "your turn" for unknown statuses
        map.get('your_turn')!.push(goal);
      }
    }
    return map;
  }, [goals]);

  const handleLaneDragOver = (e: DragEvent<HTMLDivElement>, laneId: string) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTargetLaneId !== laneId) setDropTargetLaneId(laneId);
  };

  const handleLaneDragLeave = (e: DragEvent<HTMLDivElement>, laneId: string) => {
    // Only clear if the pointer truly left this lane (not just an inner child)
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    if (dropTargetLaneId === laneId) setDropTargetLaneId(null);
  };

  const handleLaneDrop = async (e: DragEvent<HTMLDivElement>, lane: Lane) => {
    e.preventDefault();
    setDropTargetLaneId(null);
    const goalId = e.dataTransfer.getData(DRAG_MIME);
    if (!goalId) return;
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    // No-op if already in this lane.
    if (lane.statuses.includes(goal.status)) return;
    try {
      await updateGoal(goalId, { status: lane.targetStatus });
    } catch (err) {
      toastCatch('Failed to move goal')(err);
    }
  };

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="w-8 h-8 text-foreground mb-3" />
        {t.plugins.dev_tools.no_goals_kanban}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {LANES.map((lane) => {
        const Icon = lane.icon;
        const items = laneGoals.get(lane.id) ?? [];
        const isDropTarget = dropTargetLaneId === lane.id;
        return (
          <div
            key={lane.id}
            onDragOver={(e) => handleLaneDragOver(e, lane.id)}
            onDragLeave={(e) => handleLaneDragLeave(e, lane.id)}
            onDrop={(e) => handleLaneDrop(e, lane)}
            className={[
              'rounded-card border p-3 transition-all',
              lane.borderColor,
              lane.bgColor,
              isDropTarget ? `ring-2 ${lane.ringColor} scale-[1.005]` : '',
            ].join(' ')}
          >
            {/* Lane header */}
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`w-4 h-4 ${lane.iconColor}`} />
              <span className="typo-section-title">
                {dt[lane.labelKey]}
              </span>
              <span className="ml-auto text-[10px] text-foreground bg-primary/10 rounded-full px-1.5 py-0.5 font-medium">
                {items.length}
              </span>
            </div>

            {/* Goal cards */}
            <div className="space-y-2 min-h-[80px]">
              {items.length === 0 ? (
                <p className="text-[11px] text-foreground text-center py-6">
                  {isDropTarget ? t.plugins.dev_lifecycle.kanban_drop_here : t.plugins.dev_tools.no_goals_here}
                </p>
              ) : (
                items.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onDragStart={setDraggingId}
                    onDragEnd={() => setDraggingId(null)}
                    isDragging={draggingId === goal.id}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
