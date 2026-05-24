import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, ArrowUpFromLine, ArrowDownToLine, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Normalized, direction-tagged summary of a push or pull sync. Built from
 * the raw {@link PushSyncResult} / {@link PullSyncResult} IPC payloads in
 * SyncPanel so this card never has to branch on which API produced it —
 * every category is optional and only rendered when present + non-zero.
 */
export interface SyncResultSummary {
  direction: 'push' | 'pull';
  created: number;
  updated: number;
  /** Push only. */
  skipped?: number;
  /** Pull only. */
  conflicts?: number;
  /** Pull only — lucky-convergence count. */
  converged?: number;
  errors: string[];
  /** ISO timestamp of when the sync completed. */
  at: string;
}

interface CountPill {
  key: string;
  label: string;
  count: number;
  dotClass: string;
  textClass: string;
}

const PUSH_ACCENT = {
  border: 'border-l-violet-500',
  icon: 'text-violet-300',
  iconBg: 'bg-violet-500/12 border-violet-500/25',
};
const PULL_ACCENT = {
  border: 'border-l-emerald-500',
  icon: 'text-emerald-300',
  iconBg: 'bg-emerald-500/12 border-emerald-500/25',
};

export default function SyncResultCard({ summary }: { summary: SyncResultSummary }) {
  const { t, tx } = useTranslation();
  const [collapsed, setCollapsed] = useState(true);

  const ob = t.plugins.obsidian_brain;
  const isPush = summary.direction === 'push';
  const accent = isPush ? PUSH_ACCENT : PULL_ACCENT;
  const DirIcon = isPush ? ArrowUpFromLine : ArrowDownToLine;

  // Per-category pills. Order is the natural read order of a sync report;
  // each entry is dropped below when its count is zero so the headline only
  // ever shows what actually happened.
  const allPills: CountPill[] = [
    { key: 'created', label: ob.result_created, count: summary.created, dotClass: 'bg-emerald-400', textClass: 'text-emerald-300' },
    { key: 'updated', label: ob.result_updated, count: summary.updated, dotClass: 'bg-blue-400', textClass: 'text-blue-300' },
    { key: 'skipped', label: ob.result_skipped, count: summary.skipped ?? 0, dotClass: 'bg-slate-400', textClass: 'text-foreground/80' },
    { key: 'converged', label: ob.result_converged, count: summary.converged ?? 0, dotClass: 'bg-violet-400', textClass: 'text-violet-300' },
    { key: 'conflicts', label: ob.result_conflicts, count: summary.conflicts ?? 0, dotClass: 'bg-amber-400', textClass: 'text-amber-300' },
    { key: 'errors', label: ob.result_errors, count: summary.errors.length, dotClass: 'bg-red-400', textClass: 'text-red-300' },
  ];
  const pills = allPills.filter((p) => p.count > 0);

  const total = summary.created + summary.updated + (summary.skipped ?? 0) + (summary.conflicts ?? 0) + (summary.converged ?? 0);
  const headline = isPush
    ? tx(ob.result_pushed_headline, { count: total })
    : tx(ob.result_pulled_headline, { count: total });

  const hasBreakdown = pills.length > 0 || summary.errors.length > 0;

  return (
    <div className={`bg-secondary/30 border border-primary/12 shadow-elevation-1 rounded-modal border-l-[3px] ${accent.border} overflow-hidden`}>
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        disabled={!hasBreakdown}
        className="w-full flex items-center gap-3 px-3.5 py-2.5 text-left hover:bg-secondary/20 transition-colors select-none disabled:cursor-default disabled:hover:bg-transparent"
      >
        <span className={`flex-shrink-0 w-7 h-7 rounded-card border flex items-center justify-center ${accent.iconBg}`}>
          <DirIcon className={`w-3.5 h-3.5 ${accent.icon}`} />
        </span>

        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="typo-heading typo-card-label text-foreground/90">{headline}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {pills.map((p) => (
              <span
                key={p.key}
                className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-card bg-secondary/40 border border-primary/10"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${p.dotClass}`} />
                <span className={`typo-caption tabular-nums ${p.textClass}`}>{p.count}</span>
                <span className="typo-caption text-foreground">{p.label}</span>
              </span>
            ))}
          </div>
        </div>

        <span className="typo-caption text-foreground flex-shrink-0 tabular-nums">
          {new Date(summary.at).toLocaleTimeString()}
        </span>
        {hasBreakdown && (
          <motion.span
            animate={{ rotate: collapsed ? 0 : 90 }}
            transition={{ duration: 0.15 }}
            className="flex-shrink-0"
          >
            <ChevronRight className="w-3.5 h-3.5 text-foreground" />
          </motion.span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && hasBreakdown && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-primary/8 px-3.5 pb-3.5 pt-3 space-y-3">
              <div className="space-y-1.5">
                {pills.map((p) => (
                  <div key={p.key} className="flex items-center gap-2.5">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${p.dotClass}`} />
                    <span className={`typo-caption tabular-nums w-8 text-right ${p.textClass}`}>{p.count}</span>
                    <span className="typo-caption text-foreground">{p.label}</span>
                  </div>
                ))}
              </div>

              {summary.errors.length > 0 && (
                <div className="space-y-1.5">
                  <p className="typo-caption text-red-300/80">{ob.result_error_detail}</p>
                  <div className="space-y-1">
                    {summary.errors.map((err, i) => (
                      <div
                        key={i}
                        className="flex items-start gap-2 px-2.5 py-1.5 rounded-card bg-red-500/5 border border-red-500/15"
                      >
                        <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
                        <span className="typo-caption text-foreground break-words min-w-0">{err}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
