// /prototype ProjectsLayer, variant 3 - SPECIMEN (2026-10-06).
//
// Direction: a catalogue drawer of labelled specimens. Same lines, same
// columns, same doors as the baseline; each line is a LABEL that says what the
// project is made of, and each cell is a STAMP that says what was found.
//
// - Identity: a tag for the discipline (or owner), the stack it is built on in
//   mono (primary language, runtime, lead framework - fields the passport has
//   and the matrix never showed), and the name on two lines.
// - Scores: Auto and Prod as one balance bar from a centre axis, so the gap
//   between them (the "Gap" sort) is visible as asymmetry, numerals at the ends.
// - Cells: the found value printed on a stamp in its state's tone; the border
//   carries the state without colour (solid / dashed = set up / dotted =
//   unknown, unfilled = healthy).
// - Motion: stamps press in on a diagonal wave (line + column), balance bars
//   grow out from the axis, and the focus ring GLIDES from cell to cell with the
//   arrow keys (shared layout). Nothing loops.
import { motion } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import type { AppPassport } from './passport/passportModel';
import { ATLAS_WORDS as W } from './passport/atlas/atlasWords';
import type { AtlasFigureProps } from './passport/atlas/atlasFigure';
import { nameParts, shortValue, VARIANT_WORDS as V } from './projectsLayerVariantKit';
import { VariantGrid, type LineCtx } from './ProjectsLayerVariantGrid';

function stackLine(p: AppPassport): string {
  if (p.repoUnreadable) return V.unreadable;
  const lang = p.stack.languages.find((l) => l.primary) ?? p.stack.languages[0];
  return [lang?.name, p.stack.runtime, p.stack.frameworks[0]].filter(Boolean).join(' · ') || p.identity.lifecycle;
}

function SpecimenLabel({ p, names, onOpen }: LineCtx & { names: AtlasFigureProps['names']; onOpen: (slug: string) => void }) {
  const n = nameParts(p, names);
  return (
    <span role="rowheader" className="plv3-id">
      <span className="plv3-tagline">
        {(n.kicker || n.qualifier) && <span className="plv3-tag typo-caption">{n.kicker ?? n.qualifier}</span>}
        <span className="plv3-stack typo-code k-ellipsis">{stackLine(p)}</span>
      </span>
      <Button variant="ghost" size="sm" className="plv__name" onClick={() => onOpen(p.identity.slug)} data-testid={`atlas-open-${p.identity.slug}`}>
        <span className="plv__title typo-body k-strong">{n.title}{n.cut ? '…' : ''}</span>
      </Button>
    </span>
  );
}

/** Auto grows left from the axis, Prod grows right: the gap is the asymmetry. */
function BalanceBar({ auto, prod, unknown }: { auto: number; prod: number; unknown: boolean }) {
  return (
    <span role="gridcell" className="plv3-balance" aria-label={`${W.auto} ${unknown ? '?' : auto}, ${W.prod} ${unknown ? '?' : prod}`}>
      <span className="typo-caption tabular-nums text-right">{unknown ? '?' : auto}</span>
      <span className="plv3-balance__track" aria-hidden="true">
        {!unknown && <span className="plv3-balance__bar is-auto" style={{ width: `${auto / 2}%` }} />}
        {!unknown && <span className="plv3-balance__bar is-prod" style={{ width: `${prod / 2}%` }} />}
      </span>
      <span className="typo-caption tabular-nums">{unknown ? '?' : prod}</span>
    </span>
  );
}

function FocusRing() {
  const reduce = useReducedMotion();
  return <motion.span layoutId="plv3-focus" className="plv3-focus" transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 44 }} />;
}

export function SpecimenFigure(fig: AtlasFigureProps) {
  return (
    <VariantGrid
      fig={fig}
      variant="plv3"
      testId="atlas-matrix-specimen"
      scoreHeads={[`${W.auto} | ${W.prod}`]}
      cellStep={0.03}
      identity={(ctx) => <SpecimenLabel {...ctx} names={fig.names} onOpen={fig.onOpenProject} />}
      scores={({ p }) => <BalanceBar auto={p.automationReadiness.score} prod={p.productionReadiness.score} unknown={!!p.repoUnreadable} />}
      cell={({ p, r, ink, here }) => (
        <>
          {here && <FocusRing />}
          <span className="plv3-stamp typo-caption" data-ink={ink}>{ink === 'unknown' ? '?' : shortValue(r.get(p))}</span>
        </>
      )}
    />
  );
}
