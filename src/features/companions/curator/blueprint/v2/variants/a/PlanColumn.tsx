/**
 * The left ledger: her plan, one row per subject, nine reasons per row.
 *
 * Row rhythm is the kit's - `ListRow` at 48px, the state Mark on the spine,
 * one emphasised name on the reading line, figures in the trail. The only
 * thing this column adds is the signature, and the ruler above the list that
 * gives the signature its nine addresses.
 */
import { useMemo } from 'react';

import { ListRow, Meta, Rows, Section, type EmptySpec, type Glyph, type Tone } from '@/features/shared/components/kit';
import { CHANNELS } from '@/features/companions/curator/blueprint/model/channels';
import type { CellMark } from '@/features/companions/curator/blueprint/model/types';
import { useTranslation } from '@/i18n/useTranslation';

import { INK_WORD, Signature, SignatureRuler } from './Signature';
import type { PlanRow } from './planFixture';
import type { LaneSource } from './useLanes';

const CHANNEL_KEY = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9'] as const;

// i18n: her side of the page - what she would do next, projected from the scan.
const PLAN_TITLE = 'Her plan';

const STATE_MARK: Record<string, { tone: Tone; glyph: Glyph }> = {
  planned: { tone: 'neutral', glyph: 'hollow' },
  dispatched: { tone: 'primary', glyph: 'live' },
  landed: { tone: 'success', glyph: 'solid' },
  declined: { tone: 'warning', glyph: 'soft' },
  idled: { tone: 'neutral', glyph: 'empty' },
  blocked: { tone: 'error', glyph: 'solid' },
};
const FALLBACK_MARK: { tone: Tone; glyph: Glyph } = { tone: 'neutral', glyph: 'hollow' };

export interface PlanColumnProps {
  rows: readonly PlanRow[];
  /** The plan's largest single cell; every bar on every row is drawn against it. */
  max: number;
  source: LaneSource;
  loading: boolean;
}

export function PlanColumn({ rows, max, source, loading }: PlanColumnProps) {
  const { t, tx } = useTranslation();
  const w = t.companions.blueprint;

  const names = useMemo(() => CHANNEL_KEY.map((k) => w.channel[k]), [w]);
  const weights = useMemo(() => CHANNELS.map((c) => tx(w.weight_each, { n: c.weight })), [w, tx]);

  /**
   * One line per slot, in the slots' own order - the tip IS the mark, expanded.
   * The wording is the SHORT form on purpose: six or seven of the nine lines are
   * usually the same measured zero, and a tip that says one full sentence nine
   * times is a tip nobody reads to the end.
   */
  const line = (cell: CellMark, i: number, domain: string): string => {
    const name = names[i] ?? '';
    if (cell.kind === 'scored') return tx(w.cell_scored, { detail: cell.mark.detail, points: cell.mark.points });
    if (cell.kind === 'measured-zero') return `${name} - ${w.strip_measured_nothing}`;
    if (cell.kind === 'unknown') return `${name} - ${tx(w.side_demand_unknown, { domain })}`;
    return `${name} - ${w.legend_unmeasurable}, ${w.legend_unmeasurable_tip.toLowerCase()}`;
  };

  const empty: EmptySpec =
    source === 'unread'
      // i18n: her door did not answer - which is not an empty plan.
      ? { title: 'The plan could not be read', hint: 'Her door did not answer, so there is no plan AND no measurement of one.' }
      : { title: w.no_plan_title, hint: w.no_plan_body };

  const points = rows.reduce((a, r) => a + r.points, 0);

  return (
    <Section
      level={1}
      title={PLAN_TITLE}
      count={rows.length > 0 ? rows.length : undefined}
      meta={rows.length > 0 ? <Meta parts={[`${String(points)} ${w.group_points_bare}`]} /> : undefined}
      state={loading ? 'loading' : rows.length === 0 ? 'empty' : undefined}
      empty={empty}
      ghostRows={6}
    >
      {rows.length > 0 && (
        <div className="bpa-rulerbar">
          <span className="bpa-rulerbar__end">
            <SignatureRuler names={names} weights={weights} />
            <span className="bpa-pts typo-label k-quiet">{w.group_total}</span>
          </span>
        </div>
      )}
      <Rows count={rows.length} empty={empty}>
        {rows.map((row) => {
          const cells = CHANNELS.map((c) => row.cells[c.id]);
          const scored = cells.filter((c) => c.kind === 'scored').length;
          const unknown = cells.filter((c) => c.kind === 'unknown').length;
          const mark = STATE_MARK[row.state] ?? FALLBACK_MARK;
          // A total over channels that were not all measured is a FLOOR, and it
          // says so - in the tip, and with the unknown ink beside the figure.
          // i18n: the row's own total, and what it is a total OF.
          const foot = unknown > 0
            ? `${String(row.points)} points from the ${String(9 - unknown)} channels that were measured. ${String(unknown)} are unknown, so this total is a floor, not a sum.`
            : `${String(row.points)} points, over all nine channels measured.`;
          return (
            <ListRow
              key={row.id}
              size="s"
              mark={{ ...mark, label: row.state }}
              nameClass="typo-body"
              name={
                <>
                  <span className="k-strong">{row.slug}</span>{' '}
                  <span className="k-quiet">{row.taxonomy}</span>
                </>
              }
              // A subject that scores nothing routes to no engine; naming one would
              // be a claim about work that does not exist.
              meta={<Meta parts={[row.domain, row.points > 0 ? row.engine : null]} />}
              figures={
                <>
                  <Signature
                    cells={row.cells}
                    max={max}
                    lines={cells.map((c, i) => line(c, i, row.domain))}
                    foot={foot}
                    label={`${cells.map((c, i) => `${String(i + 1)} ${names[i] ?? ''}: ${INK_WORD[c.kind]}`).join('. ')}. ${foot}`}
                  />
                  <span className="bpa-pts typo-data k-regular">
                    {unknown > 0 && <i className="bpa-floor" aria-hidden="true" />}
                    {row.points}
                  </span>
                </>
              }
              state={scored === 0 ? 'muted' : undefined}
            />
          );
        })}
      </Rows>
    </Section>
  );
}
