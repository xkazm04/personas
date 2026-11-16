// The chart's top bar: where you are (crumbs), what you are reading (the
// waterline sentence), the help door, and the hairline of station marks that
// keeps every project visible even while one is open.
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';
import type { DimKey } from '../../lib/dimRegistry';
import { stationSpan } from '../soundingsGeometry';
import { useSoundingsModel } from '../context';
import { FILE } from '../useSoundingsNav';
import { ReadingLine } from './ReadingLine';

export function ChartHeader() {
  const { stations, n, geo, nav, words, liftedKey } = useSoundingsModel();
  const { m, dimLabel } = words;
  const { level, cur, curStation, goL0, closeCard, setHelpOpen } = nav;
  const { g } = geo;

  return (
    <header className="sd-top">
      <nav className="sd-crumbs" aria-label={m.soundings_where}>
        <PressSurface aria-current={level === 0 ? 'location' : undefined} onPress={goL0}>{m.world_portfolio}</PressSurface>
        {level >= 1 && curStation && (
          <>
            <span className="sd-sep" aria-hidden>{'›'}</span>
            <PressSurface aria-current={level === 1 ? 'location' : undefined} onPress={() => { if (level === 2) closeCard(); }}>{curStation.island.name}</PressSurface>
          </>
        )}
        {level === 2 && curStation && liftedKey && (
          <>
            <span className="sd-sep" aria-hidden>{'›'}</span>
            <PressSurface aria-current="location" onPress={() => undefined}>
              {liftedKey === FILE ? m.soundings_details : dimLabel(liftedKey as DimKey)}
            </PressSurface>
          </>
        )}
      </nav>
      <ReadingLine />
      <PressSurface className="sd-topbtn" aria-label={m.soundings_help_aria} onPress={() => setHelpOpen(true)}>?</PressSurface>
      {g && (
        <div className="sd-hair" aria-hidden>
          {stations.map((s) => {
            const r = stationSpan(g, s.index, level, cur ?? 0, n);
            return <i key={s.island.slug} data-mc={s.metrics.mark} style={{ left: r.l + 1, width: Math.max(2, r.w - 2) }} />;
          })}
        </div>
      )}
    </header>
  );
}
