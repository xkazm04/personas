/**
 * Knowledge plate: a waffle of memories (approved solid, awaiting review
 * hatched, rejected as an outline), one tick per distilled fact down the right
 * edge, and the knowledge-base bar along the front edge (solid when bound,
 * dashed when not). Unmeasured counts are hatched blocks, never empty cells.
 */
import type { TwinBlueprintModel } from '../../../blueprintContract';
import { FACT_TICKS, WAFFLE_CELLS, waffleCells } from '../strataModel';
import { FaceSvg, Overflow, Unmeasured } from './FaceSvg';

const COLS = 8;
const CELL = 7;
const GAP = 2.4;
const X0 = 7;
const Y0 = 6;

type CellKind = 'approved' | 'pending' | 'rejected' | 'free';

export function KnowledgeFace({ model, hatch }: { model: TwinBlueprintModel; hatch: string }) {
  const cells = waffleCells(model.knowledge.memories);
  const facts = model.knowledge.facts;
  const rows = WAFFLE_CELLS / COLS;

  const kinds: CellKind[] = [];
  if (cells) {
    for (let i = 0; i < cells.approved; i++) kinds.push('approved');
    for (let i = 0; i < cells.pending; i++) kinds.push('pending');
    for (let i = 0; i < cells.rejected; i++) kinds.push('rejected');
  }
  while (kinds.length < WAFFLE_CELLS) kinds.push('free');

  return (
    <FaceSvg hatch={hatch}>
      {cells === null ? (
        <Unmeasured hatch={hatch} x={X0} y={Y0} w={COLS * (CELL + GAP) - GAP} h={rows * (CELL + GAP) - GAP} />
      ) : (
        kinds.map((kind, i) => {
          const x = X0 + (i % COLS) * (CELL + GAP);
          const y = Y0 + Math.floor(i / COLS) * (CELL + GAP);
          if (kind === 'pending') return <rect key={i} x={x} y={y} width={CELL} height={CELL} fill={`url(#${hatch})`} data-cell={kind} />;
          const cls = kind === 'approved' ? 'sf-ink' : kind === 'rejected' ? 'sf-track' : 'sf-free';
          return <rect key={i} className={cls} x={x} y={y} width={CELL} height={CELL} data-cell={kind} />;
        })
      )}

      {facts === null ? (
        <Unmeasured hatch={hatch} x={84} y={Y0} w={9} h={36} />
      ) : (
        Array.from({ length: Math.min(facts, FACT_TICKS) }, (_, i) => (
          <rect key={i} className="sf-ink" x={84} y={Y0 + i * 3} width={9} height={1.6} />
        ))
      )}
      {facts !== null && facts > FACT_TICKS && <Overflow x={85} y={Y0 + FACT_TICKS * 3} h={4} />}

      <rect className={model.knowledge.kbBound ? 'sf-ink' : 'sf-dash'} x={X0} y={49} width={86} height={5} />
    </FaceSvg>
  );
}
