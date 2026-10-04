// One annunciator: the kit's dashboard Tile (its title is the one button, its
// rail carries the status Mark) with a drawn instrument inside. The lamp, the
// big figure and the trace all take the verdict's ink, so the eye lands on the
// lit cell; a steady cell drops to quiet ink.

import { Tile } from '@/features/shared/components/kit';
import { VERDICT_TONE } from '../shared/readings';
import type { DimState } from '../shared/dimensions';
import { Trace } from './Trace';

export function WallCell({ index, dim, trace, onOpen }: {
  index: number;
  dim: DimState;
  trace: number[] | null;
  onOpen: () => void;
}) {
  const quiet = dim.verdict === 'ok';
  return (
    <Tile
      span={3}
      title={dim.label}
      meta={dim.question}
      mark={{ tone: VERDICT_TONE[dim.verdict], glyph: dim.verdict === 'pending' ? 'hollow' : 'solid', label: dim.stateLabel }}
      actions={<kbd className="aw-key typo-code">{index}</kbd>}
      onPress={onOpen}
      testId={`mc-wall-${dim.id}`}
    >
      <div className="aw-cell" data-verdict={dim.verdict} data-quiet={quiet || undefined}>
        <div className="aw-readout">
          <span className="aw-lamp-row">
            <span className="mc-lamp" aria-hidden="true" />
            <span className="aw-state typo-label">{dim.stateLabel}</span>
          </span>
          <span className="aw-figure typo-hero">{dim.value ?? <span className="aw-dash">-</span>}</span>
        </div>
        <Trace values={trace} />
        <p className="aw-note typo-body">{dim.note}</p>
      </div>
    </Tile>
  );
}
