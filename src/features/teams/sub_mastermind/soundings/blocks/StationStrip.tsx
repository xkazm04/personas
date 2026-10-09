// The open station's instrument strip, on the waterline: live work, the next
// release, spend, errors, blockers. Six columns of label-over-value, so row
// metadata spreads instead of leaving the strip flying empty.
import { daysLate } from '../soundingsModel';
import { Tide } from '../soundingsParts';
import type { Station } from '../soundingsModel';
import { useSoundingsModel } from '../context';
import { FILE } from '../useSoundingsNav';

export function StationStrip({ station }: { station: Station }) {
  const { words, liftedKey, nav } = useSoundingsModel();
  const { m, tx } = words;
  const { flash, openCard } = nav;
  const { island } = station;
  const quiet = island.fleet.length === 0 && island.personasRunning.length === 0 && island.runners.length === 0;

  return (
    <button
      type="button"
      className={liftedKey === FILE ? 'sd-strip sd-lifted' : 'sd-strip'}
      aria-label={tx(m.soundings_strip_aria, { name: island.name })}
      data-testid="sd-strip"
      onClick={(e) => { e.stopPropagation(); openCard(FILE); }}
    >
      <div>
        <span className="sd-in-l typo-label">{m.world_fleet}</span>
        <span className="sd-in-v">
          {quiet && <span className="sd-muted">{m.lane_none}</span>}
          {island.fleet.map((f) => (
            <span key={f.id} className={flash === f.id ? 'sd-sess sd-flash' : 'sd-sess'} data-state={f.state}>
              <i />
              {(f.state === 'awaiting_input' || island.fleet.length < 3) && f.label}
              {f.state === 'awaiting_input' && <em>{m.fleet_awaiting}</em>}
            </span>
          ))}
          {island.personasRunning.length > 0 && (
            <span className="sd-muted">{tx(island.personasRunning.length === 1 ? m.far_personas_one : m.far_personas_other, { count: island.personasRunning.length })}</span>
          )}
          {island.runners.length > 0 && (
            <span className="sd-muted">{tx(island.runners.length === 1 ? m.soundings_runners_one : m.soundings_runners_other, { count: island.runners.length })}</span>
          )}
        </span>
      </div>
      <div>
        <span className="sd-in-l typo-label">{m.world_next_ship}</span>
        <span className="sd-in-v">
          {island.ship?.next ? (
            <>
              <span>{island.ship.next}</span>
              <Tide ship={island.ship} />
              <span className="typo-data">{`${island.ship.shipped}/${island.ship.total}`}</span>
              {island.ship.late
                ? <span className="sd-late-t">{tx(m.soundings_late_days, { days: daysLate(island.ship.targetDate, Date.now()) })}</span>
                : island.ship.targetDate && <span className="sd-muted">{tx(m.milestone_bar_target, { date: island.ship.targetDate })}</span>}
            </>
          ) : <span className="sd-muted">{m.soundings_none_planned}</span>}
        </span>
      </div>
      <div>
        <span className="sd-in-l typo-label">{m.world_llm_spend}</span>
        <span className="sd-in-v typo-data">{island.stats.find((x) => x.key === 'llm')?.value ?? '-'}</span>
      </div>
      <div>
        <span className="sd-in-l typo-label">{m.soundings_errors}</span>
        <span className="sd-in-v">
          {island.monitorErrors === null
            ? <span className="sd-muted">{m.soundings_not_bound}</span>
            : <span className="typo-data">{island.monitorErrors}</span>}
        </span>
      </div>
      <div>
        <span className="sd-in-l typo-label">{m.soundings_blockers}</span>
        <span className="sd-in-v typo-data">{island.blockers}</span>
      </div>
      <div className="sd-in-more"><kbd>I</kbd><span>{m.soundings_details}</span></div>
    </button>
  );
}
