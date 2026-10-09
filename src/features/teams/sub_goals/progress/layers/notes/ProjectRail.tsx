/**
 * L0 squeezed: once a project is open the filmstrip collapses into this rail.
 * Every project keeps its place as a compact entry - its name over a mini strip
 * of its goals in their status colours - so the portfolio is still in view and
 * switching project is one click.
 */
import { LayoutGrid } from 'lucide-react';
import { motion } from 'framer-motion';

import { useTranslation } from '@/i18n/useTranslation';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import Button from '@/features/shared/components/buttons/Button';

import { goalStatusMeta } from '../../../goalStatus';
import { useProgressView } from '../../canvasHost';
import type { ProgressRow } from '../../useProgressModel';
import { CardShell } from './CardShell';

export const RAIL_W = 220;
/** A long project's strip keeps one segment per goal up to this many. */
const STRIP_MAX = 40;

export function ProjectRail({
  openId,
  onOpen,
  onHome,
}: {
  openId: string;
  onOpen: (projectId: string) => void;
  onHome: () => void;
}) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { model } = useProgressView();
  return (
    <nav
      aria-label={dl.layers_projects}
      data-testid="layers-cards-rail"
      className="shrink-0 border-r border-primary/10 bg-secondary/10 flex flex-col"
      style={{ width: RAIL_W }}
    >
      <div className="px-2 pt-2 pb-1">
        <Button variant="ghost" size="sm" icon={<LayoutGrid className="w-4 h-4" />} onClick={onHome} data-testid="layers-cards-home">
          {dl.layers_portfolio}
        </Button>
      </div>
      <span className="px-4 pt-1 pb-2 typo-eyebrow">{dl.layers_projects}</span>
      <div className="flex flex-col gap-1 px-2 pb-3 overflow-y-auto">
        {model.rows.map((row) => (
          <RailEntry key={row.projectId} row={row} open={row.projectId === openId} onOpen={() => onOpen(row.projectId)} />
        ))}
      </div>
    </nav>
  );
}

function RailEntry({ row, open, onOpen }: { row: ProgressRow; open: boolean; onOpen: () => void }) {
  const reduced = useReducedMotion();
  const goals = row.goals.slice(0, STRIP_MAX);
  return (
    <div className="relative" aria-current={open ? 'true' : undefined}>
      {open && (
        <motion.span
          layoutId={reduced ? undefined : 'layers-cards-rail-lamp'}
          aria-hidden
          className="absolute inset-0 rounded-interactive bg-primary/10 ring-1 ring-primary/35"
          transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
        />
      )}
      <CardShell
        onPress={onOpen}
        testId={`layers-cards-rail-${row.projectId}`}
        className={`flex flex-col gap-1.5 px-2.5 py-2 rounded-interactive ${open ? '' : 'hover:bg-secondary/30'}`}
      >
        <span className={`truncate ${open ? 'typo-label text-primary' : 'typo-body text-foreground'}`}>{row.name}</span>
        <span className="flex gap-px h-1.5 rounded-full overflow-hidden" aria-hidden>
          {goals.length === 0 ? (
            <span className="flex-1 bg-secondary/40" />
          ) : (
            goals.map((g) => (
              <span key={g.id} className="flex-1" style={{ backgroundColor: goalStatusMeta(g.status).map.fill }} />
            ))
          )}
        </span>
      </CardShell>
    </div>
  );
}
