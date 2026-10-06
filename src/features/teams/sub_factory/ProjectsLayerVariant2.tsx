// /prototype ProjectsLayer, variant 2 - INSTRUMENT (2026-10-06).
//
// Direction: every value is a READING on a scale. Same lines, same columns,
// same doors as the baseline; the baseline's six-state dot only says which
// state a cell is in, this variant also says how far up its ladder it got.
//
// - Identity: a tile with the repo's real favicon (probed by ProjectsLayer, so
//   far only the legacy wall showed it) or a monogram, tinted by the worst
//   state, with the gap count as a corner tab; then the discipline / blockers
//   line and the name on two lines.
// - Scores: Auto and Prod as dials around their number.
// - Cells: a rung meter, one segment per rung of that dimension's own scale
//   (CI has six, Tests five, Self-verify four checks, environments three),
//   filled in the state's tone; sets with no ladder print their count.
// - Motion: dials sweep to their value and meter segments fill left to right,
//   cascading down the first screenful, once; a clicked cell answers with one
//   ring pulse. Changing the lens re-mounts the columns, so they fill again.
import { useContext } from 'react';
import { Button } from '@/features/shared/components/buttons';
import { blockersOf, countInk } from './passport/atlas/atlasModel';
import { ATLAS_WORDS as W } from './passport/atlas/atlasWords';
import type { AtlasFigureProps } from './passport/atlas/atlasFigure';
import { lineDelay, meterOf, nameParts, shortValue, VariantFavicons, VARIANT_WORDS as V, worstInk } from './projectsLayerVariantKit';
import { VariantGrid, type LineCtx } from './ProjectsLayerVariantGrid';
import { ProjectTile, RungMeter, ScoreDial } from './ProjectsLayerVariant2Parts';

function InstrumentIdentity({ p, names, onOpen }: LineCtx & { names: AtlasFigureProps['names']; onOpen: (slug: string) => void }) {
  const favicons = useContext(VariantFavicons);
  const n = nameParts(p, names);
  const blockers = blockersOf(p).length;
  const meta = [n.kicker, n.qualifier, p.repoUnreadable ? V.unreadable : blockers ? V.blockers(blockers) : V.noBlockers].filter(Boolean).join(' · ');
  return (
    <span role="rowheader" className="plv2-id">
      <ProjectTile title={n.title} ink={worstInk(p)} gaps={p.repoUnreadable ? '?' : countInk(p, 'bad')} favicon={favicons.get(p.identity.slug)} />
      <Button variant="ghost" size="sm" className="plv__name" onClick={() => onOpen(p.identity.slug)} data-testid={`atlas-open-${p.identity.slug}`}>
        <span className="typo-caption k-quiet k-ellipsis max-w-full">{meta}</span>
        <span className="plv__title typo-body k-strong">{n.title}{n.cut ? '…' : ''}</span>
      </Button>
    </span>
  );
}

export function InstrumentFigure(fig: AtlasFigureProps) {
  return (
    <VariantGrid
      fig={fig}
      variant="plv2"
      testId="atlas-matrix-instrument"
      scoreHeads={[W.auto, W.prod]}
      identity={(ctx) => <InstrumentIdentity {...ctx} names={fig.names} onOpen={fig.onOpenProject} />}
      scores={({ p, pi }) => (
        <>
          <ScoreDial score={p.automationReadiness.score} label={W.auto} unknown={!!p.repoUnreadable} delay={lineDelay(pi)} />
          <ScoreDial score={p.productionReadiness.score} label={W.prod} unknown={!!p.repoUnreadable} delay={lineDelay(pi) + 0.08} />
        </>
      )}
      cell={({ p, r, ink }) => {
        const v = r.get(p);
        return <RungMeter ink={ink} meter={meterOf(v)} count={ink === 'unknown' ? '?' : v.kind === 'chips' ? String(v.items.length || '-') : shortValue(v)} />;
      }}
    />
  );
}
