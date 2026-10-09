// The chart's top bar: where you are (crumbs), what you are reading (the
// waterline sentence), the help door, and the hairline of station marks that
// keeps every project visible even while one is open.
import { stationSpan } from '../soundingsGeometry';
import { useSoundingsModel } from '../context';
import { FILE } from '../useSoundingsNav';
import { ReadingLine } from './ReadingLine';

export function ChartHeader() {
  const { stations, n, geo, nav, words, liftedKey } = useSoundingsModel();
  const { m } = words;
  const { level, cur, curStation, goL0, closeCard, setHelpOpen } = nav;
  const { g } = geo;

  return (
    <header className="sd-top">
      <nav className="sd-crumbs" aria-label={m.soundings_where}>
        <button type="button" aria-current={level === 0 ? 'location' : undefined} onClick={goL0}>{m.world_portfolio}</button>
        {level >= 1 && curStation && (
          <>
            <span className="sd-sep" aria-hidden>{'›'}</span>
            <button type="button" aria-current={level === 1 ? 'location' : undefined} onClick={() => { if (level === 2) closeCard(); }}>{curStation.island.name}</button>
          </>
        )}
        {level === 2 && curStation && liftedKey && (
          <>
            <span className="sd-sep" aria-hidden>{'›'}</span>
            <button type="button" aria-current="location">
              {liftedKey === FILE ? m.soundings_details : curStation.island.nodes.find((x) => x.key === liftedKey)?.label}
            </button>
          </>
        )}
      </nav>
      <ReadingLine />
      <button type="button" className="sd-topbtn" aria-label={m.soundings_help_aria} onClick={() => setHelpOpen(true)}>?</button>
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
