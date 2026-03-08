import { Radio, Zap, Clock, ChevronRight } from 'lucide-react';
import type { UseCaseItem } from '@/features/shared/components/UseCasesList';

export function PipelineArrow() {
  return (
    <div className="flex items-center justify-center px-0.5 flex-shrink-0">
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/50" />
    </div>
  );
}

export function InputStageSummary({ useCase }: { useCase: UseCaseItem }) {
  const trigger = useCase.suggested_trigger;
  const subs = useCase.event_subscriptions?.filter((s) => s.enabled) ?? [];
  const hasTrigger = !!trigger;
  const hasSubscriptions = subs.length > 0;
  const hasAny = hasTrigger || hasSubscriptions;

  return (
    <div
      className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-all min-w-0 ${
        hasAny
          ? 'bg-cyan-500/8 border-cyan-500/20 text-foreground/90'
          : 'bg-secondary/40 border-primary/10 text-muted-foreground/60'
      }`}
    >
      {hasTrigger ? (
        <Zap className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
      ) : (
        <Radio className={`w-3.5 h-3.5 flex-shrink-0 ${hasSubscriptions ? 'text-cyan-400' : 'text-muted-foreground/40'}`} />
      )}
      <span className="truncate flex-1 text-left">
        {!hasAny && 'No inputs'}
        {hasTrigger && !hasSubscriptions && (
          <>
            <Clock className="w-3 h-3 text-amber-400/70 inline mr-0.5" />
            {trigger.type}
            {trigger.cron && <span className="text-muted-foreground/50 text-sm ml-1">{trigger.cron}</span>}
          </>
        )}
        {!hasTrigger && hasSubscriptions && (
          `${subs.length} event${subs.length !== 1 ? 's' : ''}`
        )}
        {hasTrigger && hasSubscriptions && (
          <>
            <Clock className="w-3 h-3 text-amber-400/70 inline mr-0.5" />
            {trigger.type} + {subs.length} event{subs.length !== 1 ? 's' : ''}
          </>
        )}
      </span>
      {hasAny && (
        <span className="text-sm font-semibold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-400 border border-cyan-500/20 flex-shrink-0">
          Input
        </span>
      )}
    </div>
  );
}
