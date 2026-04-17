import { useState, useEffect, useCallback } from 'react';
import { ChevronRight, ChevronDown, Clock } from 'lucide-react';
import { listExecutions } from '@/api/agents/executions';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';
import { formatRelativeTime, formatDuration, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

interface UseCaseGeneralHistoryProps {
  personaId: string;
  refreshSignal: number;
}

export function UseCaseGeneralHistory({ personaId, refreshSignal }: UseCaseGeneralHistoryProps) {
  const { t } = useTranslation();
  const uc = t.agents.use_cases;
  const [showGeneralHistory, setShowGeneralHistory] = useState(false);
  const [generalHistory, setGeneralHistory] = useState<PersonaExecution[]>([]);
  const [generalHistoryLoading, setGeneralHistoryLoading] = useState(false);

  const fetchGeneralHistory = useCallback(async () => {
    if (!personaId) return;
    setGeneralHistoryLoading(true);
    try {
      const all = await listExecutions(personaId, 50);
      // Show executions with no use_case_id
      setGeneralHistory(all.filter((e) => !e.use_case_id));
    } catch {
      // intentional: non-critical -- background history fetch
      setGeneralHistory([]);
    } finally {
      setGeneralHistoryLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    if (showGeneralHistory) {
      fetchGeneralHistory();
    }
  }, [showGeneralHistory, fetchGeneralHistory, refreshSignal]);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/10 overflow-hidden">
      <button
        onClick={() => setShowGeneralHistory(!showGeneralHistory)}
        className="w-full flex items-center gap-2 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors"
      >
        {showGeneralHistory ? (
          <ChevronDown className="w-3.5 h-3.5 text-foreground" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-foreground" />
        )}
        <Clock className="w-3.5 h-3.5 text-foreground" />
        <span className="text-sm text-foreground">
          {uc.general_history}
          {!showGeneralHistory && generalHistory.length > 0 && (
            <span className="ml-1 text-foreground">
              {generalHistory.length === 1
                ? uc.unlinked_executions.replace('{count}', String(generalHistory.length))
                : uc.unlinked_executions_other.replace('{count}', String(generalHistory.length))}
            </span>
          )}
        </span>
      </button>

      {showGeneralHistory && (
        <div className="border-t border-primary/10">
          {generalHistoryLoading ? (
            <div className="px-4 py-3 text-sm text-foreground">{t.common.loading}</div>
          ) : generalHistory.length === 0 ? (
            <div className="px-4 py-3 text-sm text-foreground">
              {uc.no_unlinked_executions}
            </div>
          ) : (
            <div className="divide-y divide-primary/5 max-h-64 overflow-y-auto">
              {generalHistory.slice(0, 20).map((exec) => {
                const statusEntry = getStatusEntry(exec.status);
                return (
                  <div key={exec.id} className="px-4 py-2 flex items-center gap-3">
                    <span className={`px-1.5 py-0.5 text-sm font-medium rounded border ${badgeClass(statusEntry)} uppercase`}>
                      {statusEntry.label}
                    </span>
                    <span className="text-sm text-foreground font-mono w-14 flex-shrink-0">
                      {formatDuration(exec.duration_ms)}
                    </span>
                    <span className="text-sm text-foreground flex-1 truncate">
                      {formatRelativeTime(exec.created_at)}
                    </span>
                    {exec.cost_usd > 0 && (
                      <span className="text-sm text-foreground font-mono flex-shrink-0">
                        ${exec.cost_usd.toFixed(4)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
