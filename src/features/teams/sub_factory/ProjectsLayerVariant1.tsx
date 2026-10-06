// /prototype ProjectsLayer, variant 1 - DOSSIER (2026-10-06).
//
// Direction: the matrix read like a typeset register. Same lines, same
// columns, same doors as the baseline; what changes is that every line is an
// ENTRY you can read and every cell PRINTS its value under its mark.
//
// - Identity: the importer's `Gig · discipline · brief` is split, so the
//   discipline is a small-caps kicker and the brief is the name, on two lines.
//   Repos without a kicker carry their lifecycle and criticality there instead.
//   The worst state is a severity rule down the left edge (solid / hatched /
//   dashed, so it reads without colour), and the gap count is a numeral.
// - Scores: the number set large with the rung it reached under it (L3, Beta).
// - Cells: the baseline's state mark with the value itself in a caption line.
// - Motion: the severity rules draw downward line by line on mount, values rise
//   in after them, and the selection spine SLIDES between lines (layout
//   animation) instead of jumping. Nothing loops.
import { motion } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { PROD_BAND_LABEL } from './passport/passportModel';
import { countInk } from './passport/atlas/atlasModel';
import { InkDot } from './passport/atlas/AtlasParts';
import { ATLAS_WORDS as W, INK_MARK } from './passport/atlas/atlasWords';
import type { AtlasFigureProps } from './passport/atlas/atlasFigure';
import { nameParts, shortValue, VARIANT_WORDS as V, worstInk } from './projectsLayerVariantKit';
import { inkTone, VariantGrid, type LineCtx } from './ProjectsLayerVariantGrid';

function DossierIdentity({ p, selected, names, onOpen }: LineCtx & { names: AtlasFigureProps['names']; onOpen: (slug: string) => void }) {
  const reduce = useReducedMotion();
  const n = nameParts(p, names);
  const worst = worstInk(p);
  const gaps = p.repoUnreadable ? '?' : countInk(p, 'bad');
  const kicker = n.kicker ?? `${p.identity.lifecycle} · ${p.identity.criticality}`;
  return (
    <span role="rowheader" className="plv1-id">
      {selected && (
        <motion.span layoutId="plv1-spine" className="plv1-spine" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42 }} />
      )}
      <span className="plv1-rule" data-ink={worst} style={inkTone(worst)} role="img" aria-label={INK_MARK[worst].label} />
      <Button variant="ghost" size="sm" className="plv__name" onClick={() => onOpen(p.identity.slug)} data-testid={`atlas-open-${p.identity.slug}`}>
        <span className="plv1-kicker typo-eyebrow">
          <span className="k-ellipsis">{kicker}</span>
          {n.qualifier && <span className="typo-caption k-regular normal-case">{n.qualifier}</span>}
        </span>
        <span className="plv__title typo-body k-strong" aria-label={n.cut ? `${n.title}, ${V.cut}` : undefined}>
          {n.title}{n.cut ? '…' : ''}
        </span>
      </Button>
      <span className="plv1-gaps">
        <span className={`typo-data k-strong${gaps ? ' text-status-error' : ' k-quiet'}`}>{gaps}</span>
        <span className="typo-caption k-quiet">{W.gaps}</span>
      </span>
    </span>
  );
}

function DossierScore({ value, rung, unknown }: { value: number; rung: string; unknown: boolean }) {
  return (
    <span role="gridcell" className="plv1-score">
      <span className="typo-heading tabular-nums">{unknown ? '-' : value}</span>
      <span className="typo-caption k-quiet">{unknown ? INK_MARK.unknown.label : rung}</span>
    </span>
  );
}

export function DossierFigure(fig: AtlasFigureProps) {
  return (
    <VariantGrid
      fig={fig}
      variant="plv1"
      testId="atlas-matrix-dossier"
      scoreHeads={[W.auto, W.prod]}
      identity={(ctx) => <DossierIdentity {...ctx} names={fig.names} onOpen={fig.onOpenProject} />}
      scores={({ p }) => (
        <>
          <DossierScore value={p.automationReadiness.score} rung={p.automationReadiness.level} unknown={!!p.repoUnreadable} />
          <DossierScore value={p.productionReadiness.score} rung={PROD_BAND_LABEL[p.productionReadiness.band]} unknown={!!p.repoUnreadable} />
        </>
      )}
      cell={({ p, r, ink }) => (
        <>
          <InkDot ink={ink} />
          <span className="plv1-cell__word typo-caption k-ellipsis">{ink === 'unknown' ? '?' : shortValue(r.get(p))}</span>
        </>
      )}
    />
  );
}
