import { useEffect, useRef } from 'react';
import { XCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

interface RevitalizeProgressProps {
  lines: string[];
  onCancel: () => void;
}

/** Live narration of a running pass: spinner, scroll-pinned log, cancel. */
export default function RevitalizeProgress({ lines, onCancel }: RevitalizeProgressProps) {
  const { t } = useTranslation();
  const ob = t.plugins.obsidian_brain;
  const logRef = useRef<HTMLDivElement | null>(null);

  // Pin the log to the newest line as it streams.
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className="rounded-modal border border-violet-500/20 bg-violet-500/5 overflow-hidden animate-fade-slide-in">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-violet-500/15">
        <LoadingSpinner size="sm" />
        <div className="min-w-0 flex-1">
          <p className="typo-heading text-violet-200">{ob.revitalize_running_title}</p>
          <p className="typo-caption text-foreground/90">{ob.revitalize_running_hint}</p>
        </div>
        <button
          onClick={onCancel}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 typo-caption rounded-card text-foreground border border-primary/15 hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/25 transition-colors focus-ring"
        >
          <XCircle className="w-3.5 h-3.5" />
          {ob.revitalize_cancel}
        </button>
      </div>
      <div
        ref={logRef}
        className="px-5 py-3 max-h-64 overflow-y-auto font-mono typo-caption text-foreground space-y-1"
      >
        {lines.map((line, i) => (
          <p key={i} className="whitespace-pre-wrap break-words leading-relaxed">
            {line}
          </p>
        ))}
      </div>
    </div>
  );
}
