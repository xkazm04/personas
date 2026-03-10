import { memo } from 'react';
import { History, Loader2, Calendar } from 'lucide-react';
import type { TimeRange } from '@/hooks/realtime/useTimelineReplay';
import { RANGE_OPTIONS } from './timelinePlayerHelpers';

export const ReplayEntryBar = memo(function ReplayEntryBar({
  loading,
  onEnterReplay,
}: {
  loading: boolean;
  onEnterReplay: (range: TimeRange) => Promise<void>;
}) {
  return (
    <div className="flex items-center justify-center gap-3 px-4 py-2.5 bg-gradient-to-r from-background/90 via-secondary/30 to-background/90 border-t border-primary/10">
      <History className="w-3.5 h-3.5 text-muted-foreground/50" />
      <span className="text-sm text-muted-foreground/60 font-medium tracking-wide">
        REPLAY
      </span>
      <div className="w-px h-4 bg-primary/10" />
      {RANGE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          disabled={loading}
          onClick={() => onEnterReplay(opt.value)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-bold rounded-xl bg-primary/5 border border-primary/10 text-muted-foreground/70 hover:text-foreground/80 hover:bg-primary/10 hover:border-primary/20 transition-all active:scale-[0.97] disabled:opacity-40"
        >
          {loading ? (
            <Loader2 className="w-3 h-3 animate-spin" />
          ) : (
            <Calendar className="w-3 h-3" />
          )}
          Last {opt.label}
        </button>
      ))}
    </div>
  );
});
