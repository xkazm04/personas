/**
 * One spread row: rank, state, subject, bundle, the nine marks, the total.
 *
 * The row IS the graphic. Nothing is truncated into an ellipsis and nothing is
 * promoted into a chart somewhere else; the nine columns carry the nine
 * reasons in their own order, and the descent grows these very cells.
 */
import { Fragment, memo } from 'react';

import { channelColour, CHANNEL_ORDER } from '../model/channels';
import type { BlueprintModel, BlueprintRow } from '../model/types';
import { fmt, widthPct } from '../format';
import { useWords } from '../words';

import { LedgerCell } from './LedgerCell';
import { STATE_GLYPH, stateColour } from './vocabulary';

/**
 * The fallback when a domain reached the row without a derived mark. Cut by
 * CODEPOINT so an astral-plane initial is not split into a lone surrogate.
 */
function unmarked(domain: string): string {
  return [...domain].slice(0, 2).join('').toUpperCase();
}

interface RowProps {
  row: BlueprintRow;
  index: number;
  model: BlueprintModel;
  current: boolean;
  dimmed: boolean;
  /** The origin band in the deep layer is the same row, drawn again. */
  asOrigin?: boolean;
  /** Which column the hovered strip grew from, so the band can ring it. */
  hot?: number | null;
}

function RowTotal({ row, model }: { row: BlueprintRow; model: BlueprintModel }) {
  const { w, tx } = useWords();
  return (
    <div
      className="cb-tot"
      data-role="cb-ledger-total"
      data-cb-tip={tx(w.row_total_tip, { points: row.points, total: fmt(model.planPoints) })}
    >
      <span className="cb-tb">
        {CHANNEL_ORDER.map((id) => {
          const cell = row.cells[id];
          if (cell.kind !== 'scored') return null;
          return (
            <i
              key={id}
              style={{
                width: widthPct(cell.mark.points, model.maxPoints),
                background: channelColour(id),
              }}
            />
          );
        })}
      </span>
      <span className={`cb-tn typo-data${row.points ? '' : ' cb-z'}`}>{row.points}</span>
    </div>
  );
}

function LedgerRowInner({ row, index, model, current, dimmed, asOrigin, hot }: RowProps) {
  const { w, tx } = useWords();
  const stateSay = w.state[row.state];
  const engineSay = w.engine[row.engine];

  return (
    <div
      className={`cb-row cb-lrow${current ? ' cb-cur' : ''}${dimmed ? ' cb-faded' : ''}`}
      data-role="cb-ledger-row"
      data-cb-row={asOrigin ? undefined : index}
      data-cb-id={row.id}
      role="option"
      tabIndex={-1}
      aria-selected={current}
    >
      <div className="cb-rk typo-caption">{row.rank}</div>
      <div
        className="cb-stg cb-gl"
        style={{ color: stateColour(row.state) }}
        data-cb-tip={tx(w.row_state_tip, { state: stateSay, engine: row.engine, say: engineSay })}
      >
        {STATE_GLYPH[row.state]}
      </div>
      <div className="cb-sl">
        <span className="cb-s typo-body">{row.slug}</span>
        <span className="cb-path typo-code">{row.taxonomy}</span>
      </div>
      <div
        className={`cb-bd typo-label${row.demandKnown ? '' : ' cb-unk'}`}
        data-cb-tip={tx(row.demandKnown ? w.row_bundle_known : w.row_bundle_unknown, {
          domain: row.domain,
        })}
      >
        {model.bundleMark[row.domain] ?? unmarked(row.domain)}
      </div>
      {/* DOM order IS column order: the rule falls between the six marks and
          the three measures exactly where the group heads divide them. */}
      {CHANNEL_ORDER.map((id) => (
        <Fragment key={id}>
          <LedgerCell
            channel={id}
            cell={row.cells[id]}
            row={row}
            maxPoints={model.maxPoints}
            maxCeiling={model.maxCeiling}
            role="cb-ledger-cell"
            ring={hot === id}
          />
          {id === 6 && <div className="cb-vrule" />}
        </Fragment>
      ))}
      <RowTotal row={row} model={model} />
    </div>
  );
}

export const LedgerRow = memo(LedgerRowInner);
