/**
 * Blueprint variant "dossier" (spark twin-portable-blueprint, WP9): INSTRUMENT
 * DOSSIER. The twin as a dashboard of four kit tiles, each drawing its
 * section's quantities with the shared instruments (unit strips on declared
 * quanta, pip meters against the slots the prompt compiler reads, topic bars
 * on the coverage threshold, a style fingerprint on the 1..5 range) and a
 * headline gauge from `sectionCoverage`.
 *
 * - detail L1: the bento (Identity 4 + Voice 8, Knowledge 4 + Training 8).
 * - detail L2 (`focus`): the chosen tile grows into a full-width section board
 *   while the others shrink into a rail of gauges (framer layout travel;
 *   reduced motion = a fade); the board's items open L3 via `onOpenDetail`.
 * - stage: the tiles stand quiet in two side rails around an empty centre for
 *   the question card; the answered tile pulses, counts up and reads out the
 *   gain and the why; `working` = a calm ghost and shimmering gauges.
 *
 * The page header (name, readiness, CTAs) is the shell's (WP6), not drawn here.
 */
import { KitHost } from '@/features/shared/components/kit';

import type { BlueprintVariantProps } from '../../blueprintContract';
import { DossierDetail } from './DossierDetail';
import { DossierStage } from './DossierStage';
import './dossier.css';

export default function DossierBlueprint(props: BlueprintVariantProps) {
  const { model, mode, focus, onFocus, onOpenDetail, delta, working, reduced } = props;
  const stage = mode === 'stage';
  return (
    <div
      className="dossier-root"
      data-testid="twin-blueprint-dossier"
      data-mode={mode}
      data-focus={stage ? 'overview' : focus ?? 'overview'}
      data-motion={reduced ? 'reduced' : 'full'}
    >
      <KitHost>
        {stage ? (
          <DossierStage model={model} delta={delta} working={working} reduced={reduced} />
        ) : (
          <DossierDetail model={model} focus={focus} onFocus={onFocus} onOpenDetail={onOpenDetail} reduced={reduced} />
        )}
      </KitHost>
    </div>
  );
}
