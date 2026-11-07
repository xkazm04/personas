import { useState, useEffect, useRef } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Wrench, Trash2, GitBranch, Puzzle } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';

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
      <Button
        type="button"
        onClick={() => setOpen((v) => !v)}
        variant="secondary"
        size="icon-sm"
        tooltip={t.templates.search.admin_tools} aria-label={t.templates.search.admin_tools}
      >
        <Wrench className="w-4 h-4" />
      </Button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] py-1.5 bg-background border border-hair rounded-card shadow-elevation-4 backdrop-blur-sm">
          {onCleanupDuplicates && (
            <button
              type="button"
              onClick={() => { onCleanupDuplicates(); setOpen(false); }}
              disabled={isCleaningUp}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 typo-body text-status-warning/80 hover:bg-status-warning/10 transition-colors text-left disabled:is-disabled"
            >
              <Trash2 className={`w-4 h-4 ${isCleaningUp ? 'animate-spin' : ''}`} />
              {t.templates.search.deduplicate}
            </button>
          )}
          {onBackfillPipeline && (
            <button
              type="button"
              onClick={() => { onBackfillPipeline(); setOpen(false); }}
              disabled={isBackfillingPipeline}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 typo-body text-role-agent/80 hover:bg-role-agent/10 transition-colors text-left disabled:is-disabled"
            >
              <GitBranch className={`w-4 h-4 ${isBackfillingPipeline ? 'animate-spin' : ''}`} />
              {t.templates.search.backfill_pipelines}
            </button>
          )}
          {onBackfillTools && (
            <button
              type="button"
              onClick={() => { onBackfillTools(); setOpen(false); }}
              disabled={isBackfillingTools}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 typo-body text-role-highlight/80 hover:bg-role-highlight/10 transition-colors text-left disabled:is-disabled"
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
