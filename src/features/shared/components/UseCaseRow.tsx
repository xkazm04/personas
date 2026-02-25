import type { ReactNode } from 'react';
import { Play, Clock, Info, Settings2, Cpu, Bell } from 'lucide-react';
import type { UseCaseItem } from './UseCasesList';

const CATEGORY_STYLES: Record<string, { bg: string; text: string }> = {
  notification:   { bg: 'bg-rose-500/10 border-rose-500/15',   text: 'text-rose-400/70' },
  'data-sync':    { bg: 'bg-cyan-500/10 border-cyan-500/15',   text: 'text-cyan-400/70' },
  monitoring:     { bg: 'bg-amber-500/10 border-amber-500/15', text: 'text-amber-400/70' },
  automation:     { bg: 'bg-violet-500/10 border-violet-500/15', text: 'text-violet-400/70' },
  communication:  { bg: 'bg-blue-500/10 border-blue-500/15',   text: 'text-blue-400/70' },
  reporting:      { bg: 'bg-emerald-500/10 border-emerald-500/15', text: 'text-emerald-400/70' },
};

const MODE_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  e2e:            { label: 'E2E',  bg: 'bg-emerald-500/10 border-emerald-500/20', text: 'text-emerald-400/80' },
  mock:           { label: 'MOCK', bg: 'bg-amber-500/10 border-amber-500/20',   text: 'text-amber-400/80' },
  non_executable: { label: 'INFO', bg: 'bg-secondary/50 border-primary/15',     text: 'text-muted-foreground/70' },
};

interface UseCaseRowProps {
  useCase: UseCaseItem;
  index: number;
  isExecuting: boolean;
  isActive: boolean;
  onExecute: (useCaseId: string, sampleInput?: Record<string, unknown>) => void;
  onToggleHistory: (useCaseId: string) => void;
  historyExpanded: boolean;
  historyContent?: ReactNode;
  onToggleConfig?: (useCaseId: string) => void;
  configExpanded?: boolean;
  configContent?: ReactNode;
}

export function UseCaseRow({
  useCase,
  index,
  isExecuting,
  isActive,
  onExecute,
  onToggleHistory,
  historyExpanded,
  historyContent,
  onToggleConfig,
  configExpanded,
  configContent,
}: UseCaseRowProps) {
  const mode = useCase.execution_mode ?? 'e2e';
  const modeBadge = (MODE_BADGE[mode] ?? MODE_BADGE.e2e)!;
  const catStyle = useCase.category ? CATEGORY_STYLES[useCase.category] : null;
  const isRunnable = mode !== 'non_executable';
  const playDisabled = !isRunnable || (isExecuting && !isActive);
  const hasModelOverride = !!useCase.model_override;
  const hasNotifications = (useCase.notification_channels?.length ?? 0) > 0;
  const hasAnyConfig = hasModelOverride || hasNotifications;

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/20 overflow-hidden">
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          {/* Index number */}
          <span className="text-sm font-semibold text-muted-foreground/50 mt-0.5 w-5 text-right flex-shrink-0">
            {index + 1}.
          </span>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-foreground/95">{useCase.title}</p>
              {useCase.category && catStyle && (
                <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${catStyle.bg} ${catStyle.text} uppercase tracking-wider`}>
                  {useCase.category.replace('-', ' ')}
                </span>
              )}
              <span className={`px-1.5 py-0.5 text-[10px] font-medium rounded border ${modeBadge.bg} ${modeBadge.text} uppercase tracking-wider`}>
                {modeBadge.label}
              </span>
            </div>
            <p className="text-sm text-foreground/60 mt-1 leading-relaxed">
              {useCase.description}
            </p>
            {/* Override indicators */}
            {hasAnyConfig && (
              <div className="flex items-center gap-2 mt-1.5">
                {hasModelOverride && (
                  <span className="flex items-center gap-1 text-[10px] text-primary/60">
                    <Cpu className="w-2.5 h-2.5" /> Custom model
                  </span>
                )}
                {hasNotifications && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400/60">
                    <Bell className="w-2.5 h-2.5" /> Notifications
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {/* Play button */}
            <button
              onClick={() => onExecute(useCase.id, useCase.sample_input ?? undefined)}
              disabled={playDisabled}
              className={`p-1.5 rounded-lg border transition-colors ${
                isActive
                  ? 'bg-primary/20 border-primary/30 text-primary'
                  : playDisabled
                    ? 'bg-secondary/30 border-primary/10 text-muted-foreground/30 cursor-not-allowed'
                    : 'bg-secondary/40 border-primary/15 text-foreground/70 hover:bg-primary/10 hover:text-primary hover:border-primary/25'
              }`}
              title={
                mode === 'non_executable'
                  ? 'This use case is informational only'
                  : isExecuting && !isActive
                    ? 'Another use case is executing'
                    : `Run ${useCase.title}`
              }
            >
              {isActive ? (
                <span className="relative flex h-3.5 w-3.5 items-center justify-center">
                  <span className="animate-ping absolute h-full w-full rounded-full bg-primary opacity-40" />
                  <span className="relative rounded-full h-2 w-2 bg-primary" />
                </span>
              ) : mode === 'non_executable' ? (
                <Info className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
            </button>

            {/* History toggle */}
            <button
              onClick={() => onToggleHistory(useCase.id)}
              className={`p-1.5 rounded-lg border transition-colors ${
                historyExpanded
                  ? 'bg-primary/10 border-primary/20 text-primary/80'
                  : 'bg-secondary/40 border-primary/15 text-muted-foreground/50 hover:text-foreground/70 hover:border-primary/25'
              }`}
              title="Toggle execution history"
            >
              <Clock className="w-3.5 h-3.5" />
            </button>

            {/* Config toggle */}
            {onToggleConfig && (
              <button
                onClick={() => onToggleConfig(useCase.id)}
                className={`p-1.5 rounded-lg border transition-colors ${
                  configExpanded
                    ? 'bg-violet-500/15 border-violet-500/25 text-violet-400'
                    : hasAnyConfig
                      ? 'bg-secondary/40 border-primary/15 text-violet-400/60 hover:text-violet-400 hover:border-violet-500/25'
                      : 'bg-secondary/40 border-primary/15 text-muted-foreground/50 hover:text-foreground/70 hover:border-primary/25'
                }`}
                title="Configure model, notifications & subscriptions"
              >
                <Settings2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Inline history slot */}
      {historyExpanded && historyContent && (
        <div className="border-t border-primary/10 bg-background/30">
          {historyContent}
        </div>
      )}

      {/* Inline config slot */}
      {configExpanded && configContent && (
        <div className="border-t border-violet-500/15 bg-violet-500/3 p-3.5">
          {configContent}
        </div>
      )}
    </div>
  );
}
