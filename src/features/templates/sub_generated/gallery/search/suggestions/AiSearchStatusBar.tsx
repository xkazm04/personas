import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Sparkles, AlertCircle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';

export function AiSearchStatusBar({
  aiSearchMode,
  aiSearchLoading,
  aiSearchRationale,
  aiSearchActive,
  aiCliLog,
  total,
}: {
  aiSearchMode?: boolean;
  aiSearchLoading?: boolean;
  aiSearchRationale?: string;
  aiSearchActive?: boolean;
  aiCliLog?: string[];
  total: number;
}) {
  const { t } = useTranslation();
  const [showCliLog, setShowCliLog] = useState(false);

  if (!aiSearchMode || (!aiSearchLoading && !aiSearchRationale)) return null;

  return (
    <div className="px-4 pb-2">
      <div className={`flex items-center gap-2 px-3 py-2 rounded-xl max-w-2xl mx-auto ${
        aiSearchLoading
          ? 'bg-indigo-500/8 border border-indigo-500/15'
          : aiSearchActive
            ? 'bg-emerald-500/8 border border-emerald-500/15'
            : 'bg-amber-500/8 border border-amber-500/15'
      }`}>
        {aiSearchLoading ? (
          <>
            <LoadingSpinner size="sm" className="text-indigo-400 flex-shrink-0" />
            <span className="text-sm text-indigo-300/80">{t.templates.search.ai_searching}</span>
          </>
        ) : aiSearchActive ? (
          <>
            <Sparkles className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            <span className="text-sm text-emerald-300/80 flex-1">{aiSearchRationale}</span>
            <span className="text-sm text-emerald-400/60 tabular-nums flex-shrink-0">{(total === 1 ? t.templates.search.ai_results_one : t.templates.search.ai_results_other).replace('{count}', String(total))}</span>
          </>
        ) : (
          <>
            <AlertCircle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
            <span className="text-sm text-amber-300/80 flex-1">{aiSearchRationale}</span>
          </>
        )}
        {/* Toggle CLI log button */}
        {aiCliLog && aiCliLog.length > 0 && (
          <button
            onClick={() => setShowCliLog(!showCliLog)}
            className="text-sm px-1.5 py-0.5 rounded bg-primary/10 text-muted-foreground/60 hover:text-foreground/70 transition-colors flex-shrink-0"
          >
            {showCliLog ? t.templates.search.hide_log : t.templates.search.show_log}
          </button>
        )}
      </div>
      {/* Collapsible CLI log panel */}
      {showCliLog && aiCliLog && aiCliLog.length > 0 && (
        <div className="mt-1.5 max-w-2xl mx-auto rounded-lg bg-black/40 border border-primary/10 overflow-hidden">
          <div className="max-h-48 overflow-y-auto p-2 font-mono text-sm leading-relaxed text-muted-foreground/60 space-y-0.5">
            {aiCliLog.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap break-all">
                <span className="text-muted-foreground/30 select-none">{String(i + 1).padStart(3, ' ')} </span>
                {line}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
