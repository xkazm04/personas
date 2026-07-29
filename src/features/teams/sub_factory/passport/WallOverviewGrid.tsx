// OVERVIEW — the wall's first layer: passport covers as a 3-column grid.
// Majority of projects on first sight; the title click keeps the existing
// open-project quick function.
//
// The blockers digest that used to sit in a footer row under each tile was
// PROMOTED onto the cover's identity line (BlockersBadge, next to the project
// name) — so the tile is now the cover, nothing more: identity + statband +
// the minimized roadmap strip into Ship.
import { motion } from 'framer-motion';

import type { AppPassport } from './passportModel';
import { scoreInk } from './passportInk';
import { CoverBody, type CoverBodyProps } from './CoverBody';
import { coverMotion } from './wallConfig';

export function WallOverviewGrid({ columns, reduce, coverProps }: {
  columns: AppPassport[];
  reduce: boolean | null;
  coverProps: (p: AppPassport) => CoverBodyProps;
}) {
  return (
    <div className="grid grid-cols-2 xl:grid-cols-3 gap-3" data-testid="passport-overview-grid">
      {columns.map((p) => {
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
          </motion.div>
        );
      })}
    </div>
  );
}
