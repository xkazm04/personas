/**
 * The right ledger: what the operator filed, in the order he filed it.
 *
 * Deliberately the SAME row as the left one - `ListRow` at 48px, the state
 * Mark on the spine, one name on the reading line, a mark and a figure in the
 * trail - so the eye reads one surface rather than two panels. What differs is
 * only what the mark counts: two facts here (topic, domain of impact) against
 * the plan's nine reasons, drawn in the identical four-ink vocabulary.
 *
 * Before the enrichment pass has run, both facts are UNKNOWN: two dotted
 * stems. That is the state the operator sees the second he pastes forty links,
 * and it is a designed state, not a shimmer - the row is complete, its skill
 * and its target are both there, and exactly two things are honestly missing.
 */
import { useMemo, useState } from 'react';

import { Tooltip } from '@/features/shared/components/display/Tooltip';
import {
  ListRow, Meta, Rows, Section, Segmented, Toolbar,
  type EmptySpec, type Glyph, type Tone,
} from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import type { Fact, QueueItem } from './queueFixture';
import type { LaneSource } from './useLanes';

const STATE_MARK: Record<string, { tone: Tone; glyph: Glyph }> = {
  queued: { tone: 'human', glyph: 'hollow' },
  dispatched: { tone: 'primary', glyph: 'live' },
  landed: { tone: 'success', glyph: 'solid' },
  declined: { tone: 'warning', glyph: 'soft' },
  failed: { tone: 'error', glyph: 'solid' },
  cancelled: { tone: 'neutral', glyph: 'empty' },
};
const FALLBACK_MARK: { tone: Tone; glyph: Glyph } = { tone: 'neutral', glyph: 'hollow' };

/** The signature's four inks, reused verbatim for a single fact. */
const FACT_CLASS: Record<Fact['kind'], string> = {
  known: 'bpa-slot bpa-slot--scored bpa-slot--full',
  none: 'bpa-slot bpa-slot--zero',
  unknown: 'bpa-slot bpa-slot--unknown',
  unmeasurable: 'bpa-slot bpa-slot--unmeasurable',
};

// i18n: the operator's own lane, which Curator drains before her own plan.
const QUEUE_TITLE = 'Your queue';
// i18n:
const FILTER_LABEL = 'Queue filter';
type Filter = 'all' | 'open' | 'settled';
const OPEN = new Set(['queued', 'dispatched']);

/** A URL is unreadable at a glance; its host plus a short tail is not. */
function host(url: string): string {
  const stripped = url.replace(/^https?:[/][/]/, '');
  return stripped.length > 42 ? `${stripped.slice(0, 41)}…` : stripped;
}

function age(minutes: number): string {
  if (minutes < 60) return `${String(minutes)}m`;
  if (minutes < 1440) return `${String(Math.round(minutes / 60))}h`;
  return `${String(Math.round(minutes / 1440))}d`;
}

export interface QueueColumnProps {
  items: readonly QueueItem[];
  source: LaneSource;
  loading: boolean;
}

export function QueueColumn({ items, source, loading }: QueueColumnProps) {
  const { t, tx } = useTranslation();
  const w = t.companions.blueprint;
  const [filter, setFilter] = useState<Filter>('all');

  const shown = useMemo(
    () => items.filter((i) => (filter === 'all' ? true : filter === 'open' ? OPEN.has(i.state) : !OPEN.has(i.state))),
    [items, filter],
  );

  const sayFact = (f: Fact, what: string): string => {
    if (f.kind === 'known') return `${what}: ${f.value}`;
    if (f.kind === 'none') return tx(w.cell_measured_zero, { name: what });
    // i18n: the pre-pass has not read this resource yet.
    if (f.kind === 'unknown') return `${what}: UNKNOWN. Nobody has read this resource, so there is nothing to show - not a blank.`;
    return tx(w.cell_unmeasurable, { name: what });
  };

  const empty: EmptySpec =
    source === 'unread'
      // i18n: the lane door did not answer, which is not an empty lane.
      ? { title: 'Your lane could not be read', hint: 'The request door did not answer, so nothing is known about what you have filed.', tone: 'warning' }
      // i18n: the lane is read, and it really is empty.
      : {
        title: 'Nothing filed yet',
        hint: 'Your lane was read and it is empty. A pasted link lands here as queued, with its topic and its domain of impact unknown until the pre-pass reads it.',
        tone: 'human',
      };

  const filterBar = (
    // i18n: all / open / settled
    <Toolbar label={FILTER_LABEL}>
      <Segmented<Filter>
        label={FILTER_LABEL}
        value={filter}
        onChange={setFilter}
        options={[
          { v: 'all', label: 'all', count: items.length },
          { v: 'open', label: 'open', count: items.filter((i) => OPEN.has(i.state)).length, tone: 'human', glyph: 'hollow' },
          { v: 'settled', label: 'settled', count: items.filter((i) => !OPEN.has(i.state)).length, tone: 'success', glyph: 'solid' },
        ]}
      />
    </Toolbar>
  );

  return (
    <Section
      level={1}
      title={QUEUE_TITLE}
      count={shown.length > 0 ? shown.length : undefined}
      state={loading ? 'loading' : shown.length === 0 ? 'empty' : undefined}
      empty={empty}
      ghostRows={6}
    >
      {shown.length > 0 && (
        <div className="bpa-rulerbar">
          {filterBar}
          <span className="bpa-rulerbar__end">
          <span className="bpa-ruler">
            {/* i18n: topic / domain of impact - the two facts the pre-pass returns */}
            <Tooltip content="topic, as the pre-pass read it" placement="top">
              <span className="bpa-ruler__n typo-label">t</span>
            </Tooltip>
            <Tooltip content="domain of impact, as the pre-pass read it" placement="top">
              <span className="bpa-ruler__n typo-label">d</span>
            </Tooltip>
          </span>
          {/* i18n: how long ago it was filed */}
          <span className="bpa-pts typo-label k-quiet">filed</span>
          </span>
        </div>
      )}
      <Rows count={shown.length} empty={empty}>
        {shown.map((item) => {
          const mark = STATE_MARK[item.state] ?? FALLBACK_MARK;
          const said = `${sayFact(item.topic, 'topic')} ${sayFact(item.impact, 'domain of impact')}`;
          return (
            <ListRow
              key={item.id}
              size="s"
              mark={{ ...mark, label: item.state }}
              nameClass="typo-body"
              name={
                item.topic.kind === 'known'
                  ? <span className="k-strong">{item.topic.value}</span>
                  : <span className="k-quiet">{item.argument ? host(item.argument) : `${item.skill}, no target`}</span>
              }
              meta={
                <Meta
                  parts={[
                    <span key="skill" className="k-tint">{item.skill}</span>,
                    item.impact.kind === 'known' ? item.impact.value : null,
                    item.outcome ?? item.note,
                  ]}
                />
              }
              figures={
                <>
                  <Tooltip placement="left" content={<span className="bpa-tip2">{said}</span>}>
                    <span className="bpa-sig" role="img" tabIndex={0} aria-label={said}>
                      <span className={FACT_CLASS[item.topic.kind]} />
                      <span className={FACT_CLASS[item.impact.kind]} />
                    </span>
                  </Tooltip>
                  <span className="bpa-pts typo-data k-regular k-quiet">{age(item.filedMinutesAgo)}</span>
                </>
              }
              state={OPEN.has(item.state) ? undefined : 'muted'}
            />
          );
        })}
      </Rows>
    </Section>
  );
}
