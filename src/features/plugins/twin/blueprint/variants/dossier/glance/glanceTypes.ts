import type { BlueprintDelta, TwinBlueprintModel } from '../../../blueprintContract';

/** What every section glance (the body of a layer-one or stage tile) receives. */
export interface GlanceProps {
  model: TwinBlueprintModel;
  /** The narrow stage rail: fewer columns, no labels a rail cannot hold at full size. */
  compact?: boolean;
  /** Room to draw more: more rows and larger instruments (a wide bento, or a wide stage rail). */
  roomy?: boolean;
  /** Stage: the last answer's delta, when it landed on this tile. */
  delta?: BlueprintDelta | null;
  /** Count changed figures up (stage, the tile the last answer landed on). */
  spring?: boolean;
  reduced: boolean;
}
