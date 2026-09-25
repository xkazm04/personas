/**
 * THE OPERATOR'S WORKING SURFACE - designed for forty at a sitting.
 *
 * Three ways to find one row among forty, and they compose: a search that
 * matches everything a row can show (skill, URL, topic, domain), a closed
 * state filter, and one chip that isolates the intakes the pre-processing pass
 * has not read. The head states the answer of the current filter against the
 * whole, so he never has to wonder whether he is looking at all of it.
 *
 * The measure he actually wants at a glance is not "how many are queued" - it
 * is HOW MUCH OF THIS SITTING IS STILL RAW, because that is what decides
 * whether the lane is readable yet. So the head draws one strip of the whole
 * lane, one unit per two intakes, split by what the pass found: read, not read,
 * nothing to name. Three claims, the page's own inks, countable.
 */
import { useMemo, type RefObject } from 'react';

import {
  ChipView,
  Meta,
  Rows,
  Section,
  SearchField,
  Segmented,
  Toolbar,
  UnitStrip,
  type SegmentOption,
} from '@/features/shared/components/kit';

import { useWords } from '../../../words';
import { AbsentFact, Fact } from './facts';
import type { Intake } from './fixture';
import { haystack, IntakeRow } from './IntakeRow';
import { EN, gaugeSay, readCount } from './strings';

export type LaneFilter = 'all' | 'queued' | 'running' | 'settled';

const IN_FILTER: Record<LaneFilter, (i: Intake) => boolean> = {
  all: () => true,
  queued: (i) => i.request.state === 'queued',
  running: (i) => i.request.state === 'dispatched',
  settled: (i) => i.request.state !== 'queued' && i.request.state !== 'dispatched',
};

/** 1 unit = 2 intakes, so forty draw as twenty countable squares. */
const PER_UNIT = 2;

export interface LaneView {
  filter: LaneFilter;
  setFilter: (f: LaneFilter) => void;
  query: string;
  setQuery: (q: string) => void;
  rawOnly: boolean;
  toggleRaw: () => void;
  /** `/` focuses the field, as the field's own hint promises. */
  searchRef: RefObject<HTMLInputElement | null>;
}

export function QueueColumn({
  intakes,
  loading,
  view,
}: {
  intakes: Intake[] | null;
  loading: boolean;
  view: LaneView;
}) {
  const { w, tx } = useWords();
  const all = useMemo(() => intakes ?? [], [intakes]);

  const counts = useMemo(() => {
    let read = 0;
    let unread = 0;
    let barren = 0;
    let queued = 0;
    for (const i of all) {
      if (i.request.state === 'queued') queued += 1;
      if (i.enrichment.kind === 'read') read += 1;
      else if (i.enrichment.kind === 'unread') unread += 1;
      else barren += 1;
    }
    return { read, unread, barren, queued };
  }, [all]);

  const needle = view.query.trim().toLowerCase();
  const shown = useMemo(
    () =>
      all.filter(
        (i) =>
          IN_FILTER[view.filter](i) &&
          (!view.rawOnly || i.enrichment.kind === 'unread') &&
          (needle === '' || haystack(i).includes(needle)),
      ),
    [all, view.filter, view.rawOnly, needle],
  );

  const options: SegmentOption<LaneFilter>[] = [
    // No count on `all`: the section head already states `shown/all`, and at
    // half width those two glyphs are what push the state filter off its line.
    { v: 'all', label: EN.allLane },
    { v: 'queued', label: w.console.request_state.queued, count: counts.queued, tone: 'human', glyph: 'hollow' },
    { v: 'running', label: w.console.request_state.dispatched, tone: 'primary', glyph: 'live' },
    { v: 'settled', label: w.docket_settled, tone: 'success', glyph: 'solid' },
  ];

  return (
    <Section
      title={<span>{w.console.lane_title}</span>}
      eyebrow={w.console.lane_note}
      count={intakes === null ? undefined : `${String(shown.length)}/${String(all.length)}`}
      meta={
        intakes === null ? (
          <Fact kind="unknown" label={w.console.lane_unread_tip}>
            {w.console.lane_unread}
          </Fact>
        ) : (
          <span className="v2b-q__gauge">
            <UnitStrip
              segments={[
                { n: counts.read / PER_UNIT, tone: 'external' },
                { n: counts.unread / PER_UNIT, tone: 'neutral', glyph: 'hollow' },
                { n: counts.barren / PER_UNIT, tone: 'neutral', glyph: 'soft' },
              ]}
              size="s"
              label={gaugeSay(counts.read, counts.unread, counts.barren)}
            />
            <Meta
              parts={[
                <span key="read" className="typo-data k-regular">
                  {readCount(counts.read)}
                </span>,
                counts.unread > 0 ? (
                  <span key="raw" className="v2b-q__gaugefact">
                    {counts.unread} <AbsentFact kind="unknown" />
                  </span>
                ) : null,
                counts.barren > 0 ? (
                  <span key="barren" className="v2b-q__gaugefact">
                    {counts.barren} <AbsentFact kind="unmeasurable" />
                  </span>
                ) : null,
              ]}
            />
          </span>
        )
      }
      state={loading ? 'loading' : intakes === null ? 'empty' : undefined}
      empty={{ title: w.console.lane_unread, hint: w.console.lane_unread_tip, tone: 'warning' }}
    >
      <Toolbar label={w.console.lane_title}>
        <SearchField
          value={view.query}
          onChange={view.setQuery}
          placeholder={w.find_placeholder}
          inputRef={view.searchRef}
          testId="v2b-lane-search"
        />
        <Segmented label={w.console.lane_title} options={options} value={view.filter} onChange={view.setFilter} />
        <ChipView
          chip={{
            id: 'raw',
            label: EN.notReadFilter,
            count: counts.unread,
            tone: 'neutral',
            glyph: 'hollow',
            state: view.rawOnly ? 'selected' : undefined,
            onPress: view.toggleRaw,
          }}
        />
      </Toolbar>
      <div className="v2b__scroll">
        <Rows
          count={shown.length}
          empty={{
            title: all.length === 0 ? w.console.lane_empty : w.find_label,
            hint: all.length === 0 ? undefined : tx(w.console.lane_count, { n: all.length, queued: counts.queued }),
            tone: 'neutral',
          }}
        >
          {shown.map((intake) => (
            <IntakeRow key={intake.request.id} intake={intake} muted={intake.request.state === 'cancelled'} />
          ))}
        </Rows>
      </div>
    </Section>
  );
}
