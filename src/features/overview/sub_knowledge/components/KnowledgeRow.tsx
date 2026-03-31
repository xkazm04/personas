import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, X, ShieldCheck } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { motion, AnimatePresence } from 'framer-motion';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import { KNOWLEDGE_TYPES, SCOPE_TYPES, COLOR_MAP, formatDuration, formatCost } from '../libs/knowledgeHelpers';
import { verifyKnowledgeAnnotation, dismissKnowledgeAnnotation } from '@/api/overview/intelligence/knowledge';
import { ConfidenceArc } from '@/features/shared/components/display/ConfidenceArc';

const cardVariants = { hidden: { opacity: 0, y: 4 }, visible: { opacity: 1, y: 0 } };
const cardTransition = { type: 'spring' as const, stiffness: 400, damping: 30, mass: 0.8 };

function formatLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatPrimitiveValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return value.toLocaleString();
  return String(value);
}

function isPrimitive(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== 'object';
}

function NestedObjectCard({ label, data }: { label: string; data: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  return (
    <motion.div variants={cardVariants} transition={cardTransition} className="bg-secondary/10 rounded-lg p-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full text-left"
      >
        <motion.div
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
        >
          <ChevronRight className="w-3 h-3 text-muted-foreground/50" />
        </motion.div>
        <span className="text-xs uppercase tracking-wider text-muted-foreground/50">{label}</span>
        <span className="text-xs text-muted-foreground/40 ml-auto">{Object.keys(data).length} fields</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 },
              opacity: { duration: 0.15 },
            }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-2 pl-4">
              {Object.entries(data).map(([k, v]) =>
                isPrimitive(v) ? (
                  <div key={k} className="bg-secondary/10 rounded-lg p-2">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">{formatLabel(k)}</div>
                    <div className="text-sm font-medium text-foreground/80 break-words">{formatPrimitiveValue(v)}</div>
                  </div>
                ) : (
                  <div key={k} className="col-span-full">
                    <NestedObjectCard label={formatLabel(k)} data={v as Record<string, unknown>} />
                  </div>
                )
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function PatternValueCard({ label, value }: { label: string; value: unknown }) {
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const allPrimitive = value.every(isPrimitive);
    if (allPrimitive) {
      return (
        <motion.div variants={cardVariants} transition={cardTransition} className="bg-secondary/10 rounded-lg p-3">
          <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">{label}</div>
          <div className="flex flex-wrap gap-1 mt-1">
            {value.map((item, i) => (
              <span key={i} className="text-xs font-medium text-foreground/80 bg-secondary/20 rounded px-1.5 py-0.5">
                {formatPrimitiveValue(item)}
              </span>
            ))}
          </div>
        </motion.div>
      );
    }
    return (
      <div className="col-span-full">
        <NestedObjectCard label={`${label} (${value.length})`} data={Object.fromEntries(value.map((v, i) => [String(i), v]))} />
      </div>
    );
  }
  if (typeof value === 'object' && value !== null) {
    return (
      <div className="col-span-full">
        <NestedObjectCard label={label} data={value as Record<string, unknown>} />
      </div>
    );
  }
  return (
    <motion.div variants={cardVariants} transition={cardTransition} className="bg-secondary/10 rounded-lg p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">{label}</div>
      <div className="text-sm font-medium text-foreground/80 break-words">{formatPrimitiveValue(value)}</div>
    </motion.div>
  );
}

/** 48×16 inline SVG sparkline showing last N execution outcomes (green=success, red=failure). */
function ExecutionSparkline({ results }: { results: boolean[] }) {
  const W = 48;
  const H = 16;
  const pad = 3;
  const n = results.length;
  if (n === 0) return null;

  const gap = n === 1 ? 0 : (W - pad * 2) / (n - 1);
  const yOk = pad + 1;
  const yFail = H - pad - 1;
  const points = results.map((ok, i) => ({
    x: pad + i * gap,
    y: ok ? yOk : yFail,
    ok,
  }));
  const polyline = points.map(p => `${p.x},${p.y}`).join(' ');

  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="inline-block align-middle flex-shrink-0" aria-label="Execution trend">
      <polyline points={polyline} fill="none" stroke="currentColor" strokeWidth={1} className="text-muted-foreground/30" />
      {points.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={1.5}
          fill={p.ok ? '#34d399' : '#f87171'}
          opacity={i === n - 1 ? 0.9 : 0.6}
        />
      ))}
    </svg>
  );
}

interface KnowledgeRowProps {
  entry: ExecutionKnowledge;
  personaName?: string;
  personaIcon?: string | null;
  personaColor?: string | null;
  onMutated?: () => void;
}

export function KnowledgeRow({ entry, personaName, personaIcon, personaColor, onMutated }: KnowledgeRowProps) {
  const [expanded, setExpanded] = useState(false);
  const config = KNOWLEDGE_TYPES[entry.knowledge_type];
  const total = entry.success_count + entry.failure_count;
  const confidencePct = Math.round(entry.confidence * 100);
  const colors = COLOR_MAP[config?.color ?? 'blue'] ?? COLOR_MAP.blue!;
  const isAnnotation = entry.knowledge_type === 'agent_annotation' || entry.knowledge_type === 'user_annotation';
  const scopeConfig = SCOPE_TYPES[entry.scope_type] ?? SCOPE_TYPES.persona!;
  const ScopeIcon = scopeConfig.icon;
  const scopeColors = COLOR_MAP[scopeConfig.color] ?? COLOR_MAP.violet!;

  let patternData: Record<string, unknown> = {};
  try { patternData = JSON.parse(entry.pattern_data); } catch { /* intentional */ }
  const recentResults = Array.isArray(patternData.recentResults)
    ? (patternData.recentResults as unknown[]).filter((v): v is boolean => typeof v === 'boolean').slice(-10)
    : [];

  const toggleExpanded = () => setExpanded(prev => !prev);

  const handleRowKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggleExpanded();
    }
  };

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
      <div role="button" tabIndex={0} onClick={toggleExpanded} onKeyDown={handleRowKeyDown} className="w-full flex items-center gap-3 px-4 py-3 text-left cursor-pointer">
        <PersonaIcon icon={personaIcon ?? null} color={personaColor ?? null} display="framed" />
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
            {!isAnnotation && recentResults.length > 1 && <ExecutionSparkline results={recentResults} />}
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
                aria-label="Verify annotation"
                className="p-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                title="Verify annotation"
              >
                <CheckCircle className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleDismiss}
                aria-label="Dismiss annotation"
                className="p-1 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
                title="Dismiss annotation"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </>
          )}
          <ConfidenceArc value={confidencePct} />
          <span className="text-xs font-mono text-muted-foreground/70 w-8 text-right">{confidencePct}%</span>
          <motion.div
            animate={{ rotate: expanded ? 180 : 0 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
          >
            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground/40" />
          </motion.div>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { type: 'spring', stiffness: 400, damping: 30, mass: 0.8 },
              opacity: { duration: 0.15 },
            }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0 space-y-3">
              {isAnnotation && entry.annotation_text && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}
                >
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-1">Annotation</div>
                  <p className="text-sm text-foreground/80 bg-secondary/20 rounded-lg p-2">{entry.annotation_text}</p>
                </motion.div>
              )}
              <motion.div
                className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                initial="hidden"
                animate="visible"
                variants={{ visible: { transition: { staggerChildren: 0.03 } } }}
              >
                <motion.div variants={{ hidden: { opacity: 0, y: 4 }, visible: { opacity: 1, y: 0 } }} transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">Successes</div>
                  <div className="text-sm font-semibold text-emerald-400">{entry.success_count}</div>
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, y: 4 }, visible: { opacity: 1, y: 0 } }} transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">Failures</div>
                  <div className="text-sm font-semibold text-red-400">{entry.failure_count}</div>
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, y: 4 }, visible: { opacity: 1, y: 0 } }} transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Cost</div>
                  <div className="text-sm font-semibold text-foreground/80">{formatCost(entry.avg_cost_usd)}</div>
                </motion.div>
                <motion.div variants={{ hidden: { opacity: 0, y: 4 }, visible: { opacity: 1, y: 0 } }} transition={{ type: 'spring', stiffness: 400, damping: 30, mass: 0.8 }}>
                  <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-0.5">Avg Duration</div>
                  <div className="text-sm font-semibold text-foreground/80">{formatDuration(entry.avg_duration_ms)}</div>
                </motion.div>
                {Object.keys(patternData).length > 0 && (
                  <motion.div className="col-span-full" variants={cardVariants} transition={cardTransition}>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground/50 mb-2">Pattern Data</div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {Object.entries(patternData).map(([key, value]) => (
                        <PatternValueCard key={key} label={formatLabel(key)} value={value} />
                      ))}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
