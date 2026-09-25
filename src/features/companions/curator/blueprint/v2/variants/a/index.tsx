/**
 * Blueprint v2, variant A - THE SIGNATURE.
 *
 * Her plan on the left, the operator's lane on the right, both drawn as the
 * same dense ledger so the eye reads one surface. The nine reasons the shipped
 * page spends nine columns on are compressed into one 114px mark per row: nine
 * slots, position is identity, and the ruler above the list carries the nine
 * channel numbers on the same grid so a reader resolves a slot to a reason by
 * reading up, not by hovering.
 *
 * The rule that outranks everything: a count, a measured zero, an unknown and
 * an unmeasurable are FOUR things. In the mark they differ by orientation - a
 * bar, a floor tick, a dotted stem, a slash - so the distinction survives a
 * colour-blind reader, both themes and greyscale. `Signature.tsx` has the
 * whole encoding; nothing here renders a `0` that nobody measured.
 *
 * ## Why a head strip and not a stat band
 *
 * Both tables are empty in the database today, so the most important thing
 * this page can say on arrival is WHICH KIND of empty each lane is, and what
 * the four inks mean. That is the head. A row of headline figures over two
 * lanes that hold nothing would be the page's own lie on first contact.
 */
import { useState } from 'react';

import { KitHost, Surface, Segmented } from '@/features/shared/components/kit';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';

import { PlanColumn } from './PlanColumn';
import { QueueColumn } from './QueueColumn';
import { MAX_CELL_POINTS } from './planFixture';
import { useLanes, type LaneSource } from './useLanes';

import './signature.css';
import './page.css';

type Feed = 'live' | 'sample';

// i18n: which of the two feeds the page is drawing.
const FEED_LABEL = 'Data';

/** The four inks, drawn at the size they are read, permanently on the page. */
function InkLegend() {
  const { t } = useTranslation();
  const w = t.companions.blueprint;
  const inks: ReadonlyArray<[string, string, string]> = [
    // i18n: "scored" has no key of its own; the other three are the page's own legend keys.
    ['bpa-slot--scored bpa-slot--full', 'scored', 'A clause the scan wrote, at the points it scored.'],
    ['bpa-slot--zero', w.legend_measured_nothing, w.legend_measured_nothing_tip],
    ['bpa-slot--unknown', w.legend_unknown, w.legend_unknown_tip],
    ['bpa-slot--unmeasurable', w.legend_unmeasurable, w.legend_unmeasurable_tip],
  ];
  return (
    <div className="bpa-legend">
      {inks.map(([cls, label, tip]) => (
        <Tooltip key={label} content={tip} placement="bottom">
          <span className="bpa-legend__i" tabIndex={0}>
            <span className="bpa-sig"><span className={`bpa-slot ${cls}`} /></span>
            <span className="typo-caption">{label}</span>
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

/** What the two doors actually answered, said out loud rather than implied. */
function sourceLine(plan: LaneSource, queue: LaneSource, loading: boolean): string {
  // i18n: the honesty banner - a read in flight, and the three answers a door gives.
  if (loading) return 'reading both doors';
  const say = (s: LaneSource) => (s === 'live' ? 'read' : s === 'empty' ? 'read, and empty' : 'no answer');
  return `plan: ${say(plan)} · your lane: ${say(queue)}`;
}

export default function BlueprintV2VariantA() {
  const [feed, setFeed] = useState<Feed>('sample');
  const lanes = useLanes(feed === 'sample');

  return (
    <div className="bpa-shell">
      <KitHost compact testId="blueprint-v2-a">
        <div className="bpa">
          <header className="bpa__head">
            <InkLegend />
            <div className="bpa__headend">
              <span className="typo-caption">{sourceLine(lanes.planSource, lanes.queueSource, lanes.loading)}</span>
              {/* i18n: live reads the two doors; sample draws the corpus fixture. */}
              <Segmented<Feed>
                label={FEED_LABEL}
                value={feed}
                onChange={setFeed}
                options={[
                  { v: 'live', label: 'live' },
                  { v: 'sample', label: 'sample' },
                ]}
              />
            </div>
          </header>

          <div className="bpa__cols">
            <div className="bpa__col">
              <Surface dense>
                <PlanColumn rows={lanes.plan} max={MAX_CELL_POINTS} source={lanes.planSource} loading={lanes.loading} />
              </Surface>
            </div>
            <div className="bpa__col">
              <Surface dense>
                <QueueColumn items={lanes.queue} source={lanes.queueSource} loading={lanes.loading} />
              </Surface>
            </div>
          </div>
        </div>
      </KitHost>
    </div>
  );
}
