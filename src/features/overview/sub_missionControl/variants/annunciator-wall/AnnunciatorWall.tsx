// Annunciator Wall: Mission Control as a control-room annunciator panel.
// Layer 1 is eight lamps-with-instruments in one 4x2 wall, one per operator
// question; a dimension that needs the operator lights up, a steady one goes
// quiet. Layer 2 is a SWAP: choosing a lamp folds the wall into a rail of the
// same eight lamps down the left, and the dimension's full detail takes the
// rest of the window. The rail keeps every verdict visible while you read.

import { useCallback, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { KitHost, Tiles } from '@/features/shared/components/kit';
import { MissionFrame } from '../shared/MissionFrame';
import { useMissionReadings } from '../shared/useMissionReadings';
import { DIM_ORDER, useDimStates, type DimId } from '../shared/dimensions';
import { useDimKeys } from '../shared/useDimKeys';
import { traceOf } from '../shared/traces';
import { WallCell } from './WallCell';
import { WallDetail } from './WallDetail';
import './annunciator.css';

export default function AnnunciatorWall() {
  const { t } = useTranslation();
  const ml = t.overview.mission_layers;
  const readings = useMissionReadings();
  const dims = useDimStates(readings);
  const [open, setOpen] = useState<DimId | null>(null);
  const back = useCallback(() => setOpen(null), []);
  useDimKeys(DIM_ORDER, setOpen, back);

  return (
    <MissionFrame testId="mc-annunciator-wall">
      <KitHost testId="mc-wall-host">
        {open === null ? (
          <div className="aw-layer1">
            <Tiles label={ml.layer_label}>
              {DIM_ORDER.map((id, i) => (
                <WallCell key={id} index={i + 1} dim={dims[id]} trace={traceOf(readings, id)} onOpen={() => setOpen(id)} />
              ))}
            </Tiles>
            <p className="aw-hint typo-caption">{ml.keys_hint}</p>
          </div>
        ) : (
          <WallDetail open={open} dims={dims} readings={readings} onOpen={setOpen} onBack={back} />
        )}
      </KitHost>
    </MissionFrame>
  );
}
