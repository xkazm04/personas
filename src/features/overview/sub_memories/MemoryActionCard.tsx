import { motion, AnimatePresence } from 'framer-motion';
import { Lightbulb, X, Gauge, Clock, AlertTriangle, Settings, GitBranch } from 'lucide-react';
import type { MemoryAction, MemoryActionKind } from './memoryActions';
import { ACTION_KIND_META } from './memoryActions';

const KIND_ICONS: Record<MemoryActionKind, typeof Gauge> = {
  throttle: Gauge,
  schedule: Clock,
  alert: AlertTriangle,
  config: Settings,
  routing: GitBranch,
};

interface MemoryActionCardProps {
  action: MemoryAction;
  onDismiss: (id: string) => void;
}

function MemoryActionCardItem({ action, onDismiss }: MemoryActionCardProps) {
  const meta = ACTION_KIND_META[action.kind];
  const Icon = KIND_ICONS[action.kind];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -20, height: 0 }}
      className={`group relative rounded-xl border ${meta.borderClass} ${meta.bgClass} p-3 transition-colors hover:border-opacity-40`}
    >
      <button
        onClick={() => onDismiss(action.id)}
        className="absolute top-2 right-2 p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-white/10 text-muted-foreground/60 hover:text-foreground/80 transition-all"
        title="Dismiss suggestion"
      >
        <X className="w-3 h-3" />
      </button>

      <div className="flex items-start gap-2.5">
        <div className={`w-7 h-7 rounded-lg ${meta.bgClass} border ${meta.borderClass} flex items-center justify-center flex-shrink-0 mt-0.5`}>
          <Icon className={`w-3.5 h-3.5 ${meta.textClass}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold px-1.5 py-0.5 rounded-md ${meta.bgClass} ${meta.textClass}`}>
              {meta.label}
            </span>
            <span className="text-sm text-muted-foreground/50 font-mono">{action.score}/10</span>
          </div>
          <p className="text-sm font-medium text-foreground/85 line-clamp-2">{action.memoryTitle}</p>
          <p className="text-sm text-muted-foreground/70 line-clamp-2">{action.rule}</p>
        </div>
      </div>
    </motion.div>
  );
}

interface MemoryActionsPanelProps {
  actions: MemoryAction[];
  onDismiss: (id: string) => void;
}

export function MemoryActionsPanel({ actions, onDismiss }: MemoryActionsPanelProps) {
  const visible = actions.filter((a) => !a.dismissed);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-500/15 bg-amber-500/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
          <Lightbulb className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-widest text-foreground/80">
          Memory Insights
        </h3>
        <span className="text-sm text-muted-foreground/50 ml-auto">{visible.length} suggestion{visible.length !== 1 ? 's' : ''}</span>
      </div>
      <AnimatePresence mode="popLayout">
        {visible.map((action) => (
          <MemoryActionCardItem key={action.id} action={action} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
