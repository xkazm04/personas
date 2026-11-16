import { useState } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { motion } from 'framer-motion';
import { ChevronRight, ArrowUpFromLine, ArrowDownToLine, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { PressSurface } from '@/features/shared/components/buttons';

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
  textClass: string;
}

const PUSH_ACCENT = {
  icon: 'text-ink-2',
  iconBg: 'bg-surface-2 border-hair-2',
};
const PULL_ACCENT = {
  icon: 'text-status-success',
  iconBg: 'bg-surface-2 border-hair-2',
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
    { key: 'created', label: ob.result_created, count: summary.created, textClass: 'text-status-success' },
    { key: 'updated', label: ob.result_updated, count: summary.updated, textClass: 'text-status-info' },
    { key: 'skipped', label: ob.result_skipped, count: summary.skipped ?? 0, textClass: 'text-ink-2' },
    { key: 'converged', label: ob.result_converged, count: summary.converged ?? 0, textClass: 'text-ink-2' },
    { key: 'conflicts', label: ob.result_conflicts, count: summary.conflicts ?? 0, textClass: 'text-status-warning' },
    { key: 'errors', label: ob.result_errors, count: summary.errors.length, textClass: 'text-status-error' },
  ];
  const pills = allPills.filter((p) => p.count > 0);

  const total = summary.created + summary.updated + (summary.skipped ?? 0) + (summary.conflicts ?? 0) + (summary.converged ?? 0);
  const headline = isPush
    ? tx(ob.result_pushed_headline, { count: total })
    : tx(ob.result_pulled_headline, { count: total });

  const hasBreakdown = pills.length > 0 || summary.errors.length > 0;

  return (
    <div className={`bg-surface-1 border border-hair rounded-card overflow-hidden`}>
      <PressSurface onPress={() => setCollapsed((c) => !c)} disabled={!hasBreakdown} className="w-full flex items-center gap-3 px-3.5 py-2.5 select-none disabled:cursor-default disabled:hover:bg-transparent">
        <span className={`flex-shrink-0 w-7 h-7 rounded-card border flex items-center justify-center ${accent.iconBg}`}>
          <DirIcon className={`w-3.5 h-3.5 ${accent.icon}`} />
        </span>

        <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="typo-heading typo-card-label">{headline}</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {pills.map((p) => (
              <span
                key={p.key}
                className={`inline-flex items-center gap-1.5 ${p.textClass}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                <span className="typo-data">{p.count}</span>
                <span className="typo-caption text-ink-2">{p.label}</span>
              </span>
            ))}
          </div>
        </div>

        <span className="typo-caption text-ink-2 flex-shrink-0 tabular-nums">
          {<AbsoluteTime timestamp={summary.at} variant="time" />}
        </span>
        {hasBreakdown && (
          <motion.span
            animate={{ rotate: collapsed ? 0 : 90 }}
            transition={{ duration: 0.15 }}
            className="flex-shrink-0"
          >
            <ChevronRight className="w-3.5 h-3.5 text-ink-2" />
          </motion.span>
        )}
      </PressSurface>

      <Collapse open={!collapsed && hasBreakdown} unmountWhenClosed duration={200}>
        <div className="border-t border-hair px-3.5 pb-3.5 pt-3 space-y-3">
          <div className="space-y-1.5">
            {pills.map((p) => (
              <div key={p.key} className="flex items-center gap-2.5">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 bg-current ${p.textClass}`} />
                <span className={`typo-data w-8 text-right ${p.textClass}`}>{p.count}</span>
                <span className="typo-caption text-ink-2">{p.label}</span>
              </div>
            ))}
          </div>

          {summary.errors.length > 0 && (
            <div className="space-y-1.5">
              <p className="typo-caption text-status-error">{ob.result_error_detail}</p>
              <div className="space-y-1">
                {summary.errors.map((err, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-2 px-2.5 py-1.5 rounded-card bg-status-error/5 border border-status-error/15"
                  >
                    <AlertCircle className="w-3.5 h-3.5 text-status-error flex-shrink-0 mt-0.5" />
                    <span className="typo-caption text-ink-2 break-words min-w-0">{err}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}
