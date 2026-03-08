import { useState } from 'react';
import { Network, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { KNOWLEDGE_TYPES, COLOR_MAP, formatDuration, formatCost } from '../libs/knowledgeHelpers';

interface KnowledgeRowProps {
  entry: ExecutionKnowledge;
  personaName?: string;
}

export function KnowledgeRow({ entry, personaName }: KnowledgeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const config = KNOWLEDGE_TYPES[entry.knowledge_type];
  const total = entry.success_count + entry.failure_count;
  const confidencePct = Math.round(entry.confidence * 100);
  const colors = COLOR_MAP[config?.color ?? 'blue'] ?? COLOR_MAP.blue!;
  const Icon = config?.icon ?? Network;

  let patternData: Record<string, unknown> = {};
  try { patternData = JSON.parse(entry.pattern_data); } catch { /* intentional */ }

  return (
    <div className="border border-primary/8 rounded-xl bg-background/40 hover:bg-background/60 transition-colors">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className={`w-7 h-7 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90 truncate">{entry.pattern_key}</span>
            <span className={`text-sm px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border} font-medium`}>
              {config?.label ?? entry.knowledge_type}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-sm text-muted-foreground/60">
            {personaName && <span>{personaName}</span>}
            <span>{total} run{total !== 1 ? 's' : ''}</span>
            <span>avg {formatCost(entry.avg_cost_usd)}</span>
            <span>{formatDuration(entry.avg_duration_ms)}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-16 h-1.5 bg-secondary/30 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${confidencePct >= 70 ? 'bg-emerald-500/70' : confidencePct >= 40 ? 'bg-amber-500/70' : 'bg-red-500/70'}`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-sm font-mono text-muted-foreground/70 w-8 text-right">{confidencePct}%</span>
          <ChevronDown className={`w-3.5 h-3.5 text-muted-foreground/40 transition-transform ${expanded ? 'rotate-180' : ''}`} />
        </div>
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0 grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-0.5">Successes</div>
                <div className="text-sm font-semibold text-emerald-400">{entry.success_count}</div>
              </div>
              <div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-0.5">Failures</div>
                <div className="text-sm font-semibold text-red-400">{entry.failure_count}</div>
              </div>
              <div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Cost</div>
                <div className="text-sm font-semibold text-foreground/80">{formatCost(entry.avg_cost_usd)}</div>
              </div>
              <div>
                <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Duration</div>
                <div className="text-sm font-semibold text-foreground/80">{formatDuration(entry.avg_duration_ms)}</div>
              </div>
              {Object.keys(patternData).length > 0 && (
                <div className="col-span-full">
                  <div className="text-sm uppercase tracking-wider text-muted-foreground/50 mb-1">Pattern Data</div>
                  <pre className="text-sm text-muted-foreground/70 bg-secondary/20 rounded-lg p-2 overflow-x-auto">
                    {JSON.stringify(patternData, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
