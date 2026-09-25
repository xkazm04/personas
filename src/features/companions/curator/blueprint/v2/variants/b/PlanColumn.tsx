/**
 * THE RANKED LIST - one measure per subject, read straight down.
 *
 * Nine columns became one line because ranking is the job: what should she run
 * tonight. So a row carries the subject, the dominant reason IN THE SCAN'S OWN
 * WORDS (never paraphrased, never flattened to "weak"), and one measure - the
 * attention points, drawn as units so two rows compare without arithmetic.
 *
 * The strip is the honest part. Its first segment is the dominant reason's own
 * points; anything the row is NOT naming is drawn behind it as hollow units,
 * so a row whose one sentence covers all of its weight and a row whose sentence
 * covers a third of it do not look alike. That hollow remainder is the invitation
 * to descend, and `ReasonSheet` is what it opens into.
 *
 * Descent is a layer swap inside this column, not a panel elsewhere: the table
 * narrows to the row you chose - literally the same `DataTable`, same columns,
 * same geometry - and the nine unfold under it.
 */
import { useCallback, useMemo } from 'react';

import { DataTable, KitButton, Meta, Section, UnitStrip, type TableRow } from '@/features/shared/components/kit';

import type { BlueprintModel, BlueprintRow } from '../../../model/types';
import { useWords } from '../../../words';
import { AbsentFact, InkLegend } from './facts';
import { ReasonSheet, restingSegments } from './ReasonSheet';
import { dominantOf, sentenceOf } from './reasons';

type Col = 'subject' | 'weight';

/** How many of the nine nobody has looked at for this row. Never a zero. */
function unknownCount(row: BlueprintRow): number {
  return Object.values(row.cells).filter((c) => c.kind === 'unknown').length;
}

export function PlanColumn({
  model,
  openId,
  onOpen,
}: {
  model: BlueprintModel;
  openId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const { w, tx } = useWords();
  const rows = model.rows;
  const open = rows?.find((r) => r.id === openId) ?? null;
  const shown = open ? [open] : (rows ?? []);

  const cols = useMemo(
    () => [
      { key: 'subject' as const, label: w.head_subject },
      { key: 'weight' as const, label: w.group_total, num: true },
    ],
    [w],
  );

  const tableRows: TableRow<Col>[] = shown.map((row) => {
    const dominant = dominantOf(row);
    const unknown = unknownCount(row);
    return {
      id: row.id,
      mark: {
        tone: dominant?.reason.tone ?? 'neutral',
        glyph: row.state === 'dispatched' ? 'live' : 'solid',
        label: tx(w.row_state_tip, { state: w.state[row.state], engine: row.engine, say: w.engine[row.engine] }),
      },
      state: open ? 'selected' : undefined,
      cells: {
        subject: (
          <span className="k-cell2">
            <span className="v2b-plan__name typo-body k-strong k-ellipsis">
              <span className="typo-data k-regular k-quiet v2b-plan__rank">{row.rank}</span>
              {row.slug}
            </span>
            <span className="v2b-plan__say typo-caption">
              <Meta
                parts={[
                  <span key="bd" className="typo-label k-regular k-quiet">
                    {model.bundleMark[row.domain] ?? row.domain}
                  </span>,
                  <span key="say" className="k-ellipsis">
                    {(dominant ? sentenceOf(dominant.cell) : null) ?? w.not_measured}
                  </span>,
                  unknown > 0 ? (
                    <span key="unk" className="v2b-plan__unknown">
                      {unknown} <AbsentFact kind="unknown" />
                    </span>
                  ) : null,
                ]}
              />
            </span>
          </span>
        ),
        weight: (
          <span className="v2b-plan__fig">
            <UnitStrip
              segments={restingSegments(row)}
              size="s"
              label={tx(w.row_total_tip, { points: row.points, total: model.planPoints ?? row.points })}
            />
            <span className="typo-data k-medium">{row.points}</span>
          </span>
        ),
      },
    };
  });

  const back = useCallback(() => {
    onOpen(null);
  }, [onOpen]);

  return (
    <Section
      // i18n: "her own plan" is the shipped console's own name for this lane.
      title={<span className="k-cap">{w.console.lane.plan}</span>}
      count={rows ? rows.length : undefined}
      eyebrow={w.verdict_want_work}
      meta={
        <Meta
          parts={[
            model.scanGeneratedAt ? tx(w.scan_at, { at: model.scanGeneratedAt.slice(0, 10) }) : w.meta_unrun,
            model.planPoints != null ? tx(w.group_points, { n: model.planPoints, total: model.subjects ?? 0 }) : null,
          ]}
        />
      }
      actions={open ? <KitButton onClick={back} quiet hint="Esc">{w.deep_back}</KitButton> : undefined}
      state={rows === null ? 'empty' : undefined}
      empty={{ title: w.no_plan_title, hint: w.no_plan_body, tone: 'neutral' }}
    >
      <div className="v2b-plan v2b__scroll" data-layer={open ? 'deep' : 'list'}>
        <DataTable
          cols={cols}
          rows={tableRows}
          label={w.ledger_region}
          empty={{ title: w.no_plan_title, hint: w.no_plan_body }}
          onRowClick={(id) => {
            onOpen(openId === id ? null : id);
          }}
          rowTestId="v2b-plan-row"
          testId="v2b-plan-table"
        />
        {open && <ReasonSheet row={open} total={rows?.length ?? 0} id="v2b-sheet" />}
      </div>
      {!open && <InkLegend />}
      {!open && rows && model.quietSubjects != null && (
        <p className="v2b-plan__tail typo-caption">
          <UnitStrip
            segments={[{ n: Math.round(model.quietSubjects / 8), tone: 'neutral', glyph: 'hollow' }]}
            size="s"
            label={w.band_quiet_title}
          />
          {model.quietSubjects} {w.band_quiet_title}
          {model.unlisted != null && model.unlisted > 0
            ? ` · ${tx(w.band_unlisted_title, { n: model.unlisted })}`
            : ''}
        </p>
      )}
    </Section>
  );
}
