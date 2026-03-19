import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Brain } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { MEMORY_CATEGORY_COLORS } from '@/lib/utils/formatters';
import { listMemoriesByExecution } from '@/api/overview/memories';
import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import { isTerminalState } from '@/lib/execution/executionState';
import { stripHtml } from '@/lib/utils/sanitizers/sanitizeHtml';

interface ExecutionMemoriesProps {
  executionId: string;
  executionStatus: string;
}

export function ExecutionMemories({ executionId, executionStatus }: ExecutionMemoriesProps) {
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

  if (!memoriesLoaded || executionMemories.length === 0) return null;

  return (
    <div>
      <button
        onClick={() => setShowMemories(!showMemories)}
        className="flex items-center gap-2 typo-body text-foreground/90 hover:text-foreground transition-colors mb-2"
      >
        {showMemories ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        <Brain className="w-4 h-4 text-violet-400" />
        Memories Created ({executionMemories.length})
      </button>
      <AnimatePresence>
        {showMemories && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="space-y-1.5">
            {executionMemories.map((mem) => {
              const defaultCat = { label: 'Fact', bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' };
              const cat = MEMORY_CATEGORY_COLORS[mem.category] ?? defaultCat;
              return (
                <div key={mem.id} className="p-3 bg-violet-500/5 border border-violet-500/15 rounded-xl">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex px-1.5 py-0.5 typo-code uppercase rounded border ${cat.bg} ${cat.text} ${cat.border}`}>
                      {cat.label}
                    </span>
                    <span className="typo-heading text-foreground/90">{stripHtml(mem.title)}</span>
                  </div>
                  <p className="typo-body text-foreground/70 line-clamp-2">{stripHtml(mem.content)}</p>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
