import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Wrench, Trash2, GitBranch, Puzzle } from 'lucide-react';

export function AdminToolsDropdown({
  onCleanupDuplicates,
  isCleaningUp,
  onBackfillPipeline,
  isBackfillingPipeline,
  onBackfillTools,
  isBackfillingTools,
}: {
  onCleanupDuplicates?: () => void;
  isCleaningUp?: boolean;
  onBackfillPipeline?: () => void;
  isBackfillingPipeline?: boolean;
  onBackfillTools?: () => void;
  isBackfillingTools?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-2 rounded-card border border-primary/10 hover:bg-primary/5 text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        title={t.templates.search.admin_tools}
      >
        <Wrench className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] py-1.5 bg-background border border-primary/20 rounded-card shadow-elevation-4 backdrop-blur-sm">
          {onCleanupDuplicates && (
            <button
              onClick={() => { onCleanupDuplicates(); setOpen(false); }}
              disabled={isCleaningUp}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-amber-400/80 hover:bg-amber-500/10 transition-colors text-left disabled:opacity-50"
            >
              <Trash2 className={`w-4 h-4 ${isCleaningUp ? 'animate-spin' : ''}`} />
              {t.templates.search.deduplicate}
            </button>
          )}
          {onBackfillPipeline && (
            <button
              onClick={() => { onBackfillPipeline(); setOpen(false); }}
              disabled={isBackfillingPipeline}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-violet-400/80 hover:bg-violet-500/10 transition-colors text-left disabled:opacity-50"
            >
              <GitBranch className={`w-4 h-4 ${isBackfillingPipeline ? 'animate-spin' : ''}`} />
              {t.templates.search.backfill_pipelines}
            </button>
          )}
          {onBackfillTools && (
            <button
              onClick={() => { onBackfillTools(); setOpen(false); }}
              disabled={isBackfillingTools}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-cyan-400/80 hover:bg-cyan-500/10 transition-colors text-left disabled:opacity-50"
            >
              <Puzzle className={`w-4 h-4 ${isBackfillingTools ? 'animate-spin' : ''}`} />
              {t.templates.search.backfill_tools}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
