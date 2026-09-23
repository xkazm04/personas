// The left column: where you stand (the altitude timeline), what the field
// is hiding (printed as figures, never swallowed), the level below (the
// nested list), and the controls. Wayfinding, not an instrument: it stays in
// every mode.
import type { RefObject } from 'react';

import { interpolate as tx } from '@/i18n/useTranslation';

import { useCouncilStore } from '../../councilStore';
import type { EnginePath, GalaxyEngine } from '../engine/GalaxyEngine';
import { AltitudeTimeline } from './AltitudeTimeline';
import { HudCommands } from './HudCommands';
import { NestedList } from './NestedList';
import { useFusedStrings } from './fusedStrings';
import type { FusedData } from './useFused';

interface Props {
  engine: GalaxyEngine | null;
  path: EnginePath;
  data: FusedData;
  navRef: RefObject<HTMLElement | null>;
}

export function NavColumn({ engine, path, data, navRef }: Props) {
  const s = useFusedStrings();
  const f = s.f;
  const layout = useCouncilStore((st) => st.layout);
  const fixtureOn = useCouncilStore((st) => st.fixtureOn);
  const counts = useCouncilStore((st) => st.counts);
  const council = useCouncilStore((st) => st.focus.kind === 'council');
  const hidden = counts.labelsHidden;

  return (
    <nav ref={navRef} className="fz-nav" aria-label={f.nav_label} data-role="hud-nav">
      <div className="n-head" data-role="hud-rung-head">
        {fixtureOn ? (
          <span className="fixture" data-role="hud-fixture">
            {f.fixture}
          </span>
        ) : null}
      </div>
      <AltitudeTimeline engine={engine} path={path} data={data} />
      <div className="fz-hides" aria-live="polite" data-role="hud-hides">
        {f.hides_before} <b>{s.n(hidden)}</b> {s.plural(hidden, f.hides_label_one, f.hides_label_other)}
        {council ? (
          <>
            {' · '}
            {tx(f.hides_dims, { count: s.n(counts.dimmed) })}
          </>
        ) : null}
      </div>
      {layout ? <NestedList engine={engine} layout={layout} path={path} waitingStars={data.waitingStars} /> : null}
      <HudCommands engine={engine} />
    </nav>
  );
}

export default NavColumn;
