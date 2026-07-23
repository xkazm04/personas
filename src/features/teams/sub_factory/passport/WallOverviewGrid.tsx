// OVERVIEW — the wall's first layer: passport covers as a 3-column grid with a
// blockers digest per tile. Majority of projects on first sight; the title
// click keeps the existing open-project quick function.
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';

import type { AppPassport } from './passportModel';
import { INK, scoreInk } from './passportInk';
import { CoverBody, type CoverBodyProps } from './CoverBody';
import { COPY, coverMotion } from './wallConfig';

export function WallOverviewGrid({ columns, reduce, coverProps }: {
  columns: AppPassport[];
  reduce: boolean | null;
  coverProps: (p: AppPassport) => CoverBodyProps;
}) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3" data-testid="passport-overview-grid">
      {columns.map((p) => {
        const blockers = [...p.productionReadiness.blockers, ...p.automationReadiness.blockers];
        const hue = scoreInk(Math.min(p.automationReadiness.score, p.productionReadiness.score));
        return (
          <motion.div
            key={p.identity.slug}
            {...coverMotion(p.identity.slug, reduce)}
            data-testid={`passport-tile-${p.identity.slug}`}
            className="rounded-modal p-4 min-w-0 bg-secondary/[0.03] shadow-elevation-1"
            style={{ border: '1px solid rgba(148,163,184,.14)', borderTop: `2px solid ${hue}55` }}
          >
            <CoverBody {...coverProps(p)} />
            <div className="mt-3 pt-2.5 border-t border-dashed border-foreground/10 min-w-0">
              {blockers.length === 0 ? (
                <span className="inline-flex items-center gap-1.5 typo-caption" style={{ color: INK.emerald }}>
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden /> {COPY.clear}
                </span>
              ) : (
                <span className="flex items-center gap-1.5 typo-caption min-w-0" style={{ color: INK.red }} title={blockers.join(' · ')}>
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden />
                  <span className="shrink-0 tabular-nums">{blockers.length}</span>
                  <span className="text-foreground/50 truncate font-normal">— {blockers[0]}</span>
                </span>
              )}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
