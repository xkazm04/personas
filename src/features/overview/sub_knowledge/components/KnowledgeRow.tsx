import { useState } from 'react';
import { Network, ChevronDown, CheckCircle, X, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { KNOWLEDGE_TYPES, SCOPE_TYPES, COLOR_MAP, formatDuration, formatCost } from '../libs/knowledgeHelpers';
import { verifyKnowledgeAnnotation, dismissKnowledgeAnnotation } from '@/api/overview/intelligence/knowledge';

interface KnowledgeRowProps {
  entry: ExecutionKnowledge;
  personaName?: string;
  onMutated?: () => void;
}

export function KnowledgeRow({ entry, personaName, onMutated }: KnowledgeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const config = KNOWLEDGE_TYPES[entry.knowledge_type];
  const total = entry.success_count + entry.failure_count;
  const confidencePct = Math.round(entry.confidence * 100);
  const colors = COLOR_MAP[config?.color ?? 'blue'] ?? COLOR_MAP.blue!;
  const Icon = config?.icon ?? Network;
  const isAnnotation = entry.knowledge_type === 'agent_annotation' || entry.knowledge_type === 'user_annotation';
  const scopeConfig = SCOPE_TYPES[entry.scope_type] ?? SCOPE_TYPES.persona!;
  const ScopeIcon = scopeConfig.icon;
  const scopeColors = COLOR_MAP[scopeConfig.color] ?? COLOR_MAP.violet!;

  let patternData: Record<string, unknown> = {};
  try { patternData = JSON.parse(entry.pattern_data); } catch { /* intentional */ }

  const handleVerify = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await verifyKnowledgeAnnotation(entry.id);
      onMutated?.();
    } catch { /* ignore */ }
  };

  const handleDismiss = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await dismissKnowledgeAnnotation(entry.id);
      onMutated?.();
    } catch { /* ignore */ }
  };

  return (
    <div className="border border-primary/8 rounded-xl bg-background/40 hover:bg-background/60 transition-colors">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <div className={`w-7 h-7 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center flex-shrink-0`}>
          <Icon className={`w-3.5 h-3.5 ${colors.text}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground/90 truncate">
              {isAnnotation && entry.annotation_text ? entry.annotation_text : entry.pattern_key}
            </span>
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${colors.bg} ${colors.text} border ${colors.border} font-medium`}>
              {config?.label ?? entry.knowledge_type}
            </span>
            {entry.scope_type !== 'persona' && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${scopeColors.bg} ${scopeColors.text} border ${scopeColors.border} font-medium flex items-center gap-1`}>
                <ScopeIcon className="w-2.5 h-2.5" />
                {entry.scope_id ?? entry.scope_type}
              </span>
            )}
            {entry.is_verified && (
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground/60">
            {personaName && <span>{personaName}</span>}
            {!isAnnotation && <span>{total} run{total !== 1 ? 's' : ''}</span>}
            {!isAnnotation && <span>avg {formatCost(entry.avg_cost_usd)}</span>}
            {!isAnnotation && <span>{formatDuration(entry.avg_duration_ms)}</span>}
            {isAnnotation && entry.annotation_source && <span>by {entry.annotation_source}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {isAnnotation && !entry.is_verified && (
            <>
              <button
                onClick={handleVerify}
                className="p-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                title="Verify annotation"
              >
                <CheckCircle className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDismiss}
                className="p-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                title="Dismiss annotation"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <div className="w-16 h-1.5 bg-secondary/30 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${confidencePct >= 70 ? 'bg-emerald-500/70' : confidencePct >= 40 ? 'bg-amber-500/70' : 'bg-red-500/70'}`}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
          <span className="text-xs font-mono text-muted-foreground/70 w-8 text-right">{confidencePct}%</span>
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
            <div className="px-4 pb-3 pt-0 space-y-3">
              {isAnnotation && entry.annotation_text && (
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-1">Annotation</div>
                  <p className="text-sm text-foreground/80 bg-secondary/20 rounded-lg p-2">{entry.annotation_text}</p>
                </div>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">Successes</div>
                  <div className="text-sm font-semibold text-emerald-400">{entry.success_count}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">Failures</div>
                  <div className="text-sm font-semibold text-red-400">{entry.failure_count}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Cost</div>
                  <div className="text-sm font-semibold text-foreground/80">{formatCost(entry.avg_cost_usd)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Duration</div>
                  <div className="text-sm font-semibold text-foreground/80">{formatDuration(entry.avg_duration_ms)}</div>
                </div>
                {Object.keys(patternData).length > 0 && (
                  <div className="col-span-full">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-1">Pattern Data</div>
                    <pre className="text-xs text-muted-foreground/70 bg-secondary/20 rounded-lg p-2 overflow-x-auto">
                      {JSON.stringify(patternData, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
