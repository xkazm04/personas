import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import { listMemoriesByExecution } from '@/api/overview/memories';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { isTerminalState } from '@/lib/execution/executionState';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';
import { CategoryChip } from '@/features/shared/components/display/CategoryChip';

interface ExecutionMemoriesProps {
  executionId: string;
  executionStatus: string;
}

export function ExecutionMemories({ executionId, executionStatus }: ExecutionMemoriesProps) {
  const { t, tx } = useTranslation();
  const [executionMemories, setExecutionMemories] = useState<PersonaMemory[]>([]);
  const [showMemories, setShowMemories] = useState(false);
  const [memoriesLoaded, setMemoriesLoaded] = useState(false);

  useEffect(() => {
    if (isTerminalState(executionStatus) && executionStatus !== 'cancelled') {
      listMemoriesByExecution(executionId)
        .then((memories) => {
          setExecutionMemories(memories);
          setMemoriesLoaded(true);
        })
        .catch(() => setMemoriesLoaded(true));
    }
  }, [executionId, executionStatus]);

  if (!memoriesLoaded) {
    return (
      <div className="flex items-center gap-2 text-foreground typo-body py-1">
        <LoadingSpinner size="sm" label={t.agents.executions.loading_memories} />
      </div>
    );
  }

  if (executionMemories.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setShowMemories(!showMemories)}
        className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors mb-2"
      >
        {showMemories ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <Brain className="w-4 h-4 text-violet-400" />
        {tx(t.agents.executions.memories_created, { count: executionMemories.length })}
      </button>
      {showMemories && (
          <div className="animate-fade-slide-in space-y-1.5">
            {executionMemories.map((mem) => {
              return (
                <div key={mem.id} className="p-3 bg-violet-500/5 border border-violet-500/15 rounded-modal">
                  <div className="flex items-center gap-2 mb-1">
                    <CategoryChip category={mem.category} />
                    <span className="typo-heading text-foreground/90">{stripHtml(mem.title)}</span>
                  </div>
                  <p className="typo-body text-foreground line-clamp-2">{stripHtml(mem.content)}</p>
                </div>
              );
            })}
          </div>
        )}
    </div>
  );
}
