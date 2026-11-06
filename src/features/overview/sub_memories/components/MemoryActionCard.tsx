import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { Lightbulb, X, Gauge, Clock, AlertTriangle, Settings, GitBranch } from 'lucide-react';
import type { MemoryAction, MemoryActionKind } from '../libs/memoryActions';
import { ACTION_KIND_META } from '../libs/memoryActions';

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
  const { t } = useTranslation();
  const meta = ACTION_KIND_META[action.kind];
  const Icon = KIND_ICONS[action.kind];

  return (
    <div
      className={`animate-fade-slide-in group relative rounded-modal border ${meta.borderClass} ${meta.bgClass} p-3 transition-colors hover:border-opacity-40`}
    >
      <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100" onClick={() => onDismiss(action.id)} tooltip={t.overview.memory_actions.dismiss_suggestion}>
        <X className="w-3 h-3" />
      </Button>

      <div className="flex items-start gap-2.5">
        <div className={`w-7 h-7 rounded-card ${meta.bgClass} border ${meta.borderClass} flex items-center justify-center flex-shrink-0 mt-0.5`}>
          <Icon className={`w-3.5 h-3.5 ${meta.textClass}`} />
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className={`typo-heading px-1.5 py-0.5 rounded-input ${meta.bgClass} ${meta.textClass}`}>
              {t.overview.memory_actions[`kind_${action.kind}`]}
            </span>
            <span className="typo-code text-ink-2">{action.score}/10</span>
          </div>
          <p className="typo-heading text-ink-2 line-clamp-2">{action.memoryTitle}</p>
          <p className="typo-body text-foreground line-clamp-2">{action.rule}</p>
        </div>
      </div>
    </div>
  );
}

interface MemoryActionsPanelProps {
  actions: MemoryAction[];
  onDismiss: (id: string) => void;
}

export function MemoryActionsPanel({ actions, onDismiss }: MemoryActionsPanelProps) {
  const { t, tx } = useTranslation();
  const visible = actions.filter((a) => !a.dismissed);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-modal border border-status-warning/15 bg-status-warning/[0.03] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-card bg-status-warning/10 text-status-warning">
          <Lightbulb className="w-3.5 h-3.5" />
        </div>
        <h3 className="typo-label text-ink-2">
          {t.overview.memory_actions.memory_insights}
        </h3>
        <span className="typo-body text-foreground ml-auto">{visible.length !== 1 ? tx(t.overview.memory_actions.suggestions, { count: visible.length }) : tx(t.overview.memory_actions.suggestions_one, { count: visible.length })}</span>
      </div>
      {visible.map((action) => (
          <MemoryActionCardItem key={action.id} action={action} onDismiss={onDismiss} />
        ))}
    </div>
  );
}
