import { useMemo } from 'react';
import { User, Bot, CheckCircle2, Clock, AlertCircle, Target } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import type { DevGoal } from '@/lib/bindings/DevGoal';

// ---------------------------------------------------------------------------
// Lane definitions
// ---------------------------------------------------------------------------

interface Lane {
  id: string;
  label: string;
  icon: typeof User;
  iconColor: string;
  borderColor: string;
  bgColor: string;
  statuses: string[];
}

const LANES: Lane[] = [
  {
    id: 'your_turn',
    label: 'Your Turn',
    icon: User,
    iconColor: 'text-amber-400',
    borderColor: 'border-amber-500/25',
    bgColor: 'bg-amber-500/5',
    statuses: ['review', 'pending', 'blocked'],
  },
  {
    id: 'agent_turn',
    label: "Agent's Turn",
    icon: Bot,
    iconColor: 'text-blue-400',
    borderColor: 'border-blue-500/25',
    bgColor: 'bg-blue-500/5',
    statuses: ['in_progress', 'running'],
  },
  {
    id: 'done',
    label: 'Done',
    icon: CheckCircle2,
    iconColor: 'text-emerald-400',
    borderColor: 'border-emerald-500/25',
    bgColor: 'bg-emerald-500/5',
    statuses: ['completed', 'done'],
  },
];

// ---------------------------------------------------------------------------
// Goal card
// ---------------------------------------------------------------------------

function GoalCard({ goal }: { goal: DevGoal }) {
  const progressPct = goal.progress ?? 0;

  return (
    <div className="rounded-modal border border-primary/10 bg-background/60 p-3 hover:border-primary/20 transition-colors">
      <div className="flex items-start gap-2">
        <Target className="w-3.5 h-3.5 text-primary/60 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <h4 className="typo-card-label truncate">{goal.title}</h4>
          {goal.description && (
            <p className="text-[11px] text-foreground mt-0.5 line-clamp-2">{goal.description}</p>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {progressPct > 0 && (
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1 bg-primary/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary/50 rounded-full transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="text-[9px] text-foreground w-7 text-right">{progressPct}%</span>
        </div>
      )}

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

function StatusChip({ status }: { status: string }) {
  const config: Record<string, { label: string; className: string }> = {
    pending: { label: 'Pending', className: 'text-foreground border-primary/15 bg-primary/5' },
    review: { label: 'Review', className: 'text-amber-400 border-amber-500/25 bg-amber-500/10' },
    blocked: { label: 'Blocked', className: 'text-red-400 border-red-500/25 bg-red-500/10' },
    in_progress: { label: 'In Progress', className: 'text-blue-400 border-blue-500/25 bg-blue-500/10' },
    running: { label: 'Running', className: 'text-blue-400 border-blue-500/25 bg-blue-500/10' },
    completed: { label: 'Done', className: 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10' },
    done: { label: 'Done', className: 'text-emerald-400 border-emerald-500/25 bg-emerald-500/10' },
  };
  const c = config[status] ?? { label: status, className: 'text-foreground border-primary/15 bg-primary/5' };

  return (
    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full border ${c.className}`}>
      {c.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main kanban component
// ---------------------------------------------------------------------------

export default function GoalKanban() {
  const goals = useSystemStore((s) => s.goals);

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

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <AlertCircle className="w-8 h-8 text-foreground mb-3" />
        <p className="typo-body text-foreground">No goals yet. Create goals to see them here.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-4">
      {LANES.map((lane) => {
        const Icon = lane.icon;
        const items = laneGoals.get(lane.id) ?? [];
        return (
          <div key={lane.id} className={`rounded-card border ${lane.borderColor} ${lane.bgColor} p-3`}>
            {/* Lane header */}
            <div className="flex items-center gap-2 mb-3">
              <Icon className={`w-4 h-4 ${lane.iconColor}`} />
              <span className="typo-section-title">
                {lane.label}
              </span>
              <span className="ml-auto text-[10px] text-foreground bg-primary/10 rounded-full px-1.5 py-0.5 font-medium">
                {items.length}
              </span>
            </div>

            {/* Goal cards */}
            <div className="space-y-2 min-h-[80px]">
              {items.length === 0 ? (
                <p className="text-[11px] text-foreground text-center py-6">
                  No goals here
                </p>
              ) : (
                items.map((goal) => <GoalCard key={goal.id} goal={goal} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
