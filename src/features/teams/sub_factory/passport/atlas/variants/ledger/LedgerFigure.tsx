// THESIS — the portfolio's real question is "which DIMENSION fails across the
// estate", and the page head already answers it in counts ("N dimensions fail
// somewhere"). So the dimension is the row, the six states are columns, and the
// projects are the detail inside the row, named rather than drawn as marks. One
// UnifiedTable, the app's one table system, sorted by the count below — which
// is the ranking the reader came for and the matrix never puts in order.
//
// A dimension-major reading of the same model: same projects, same lens rows,
// same two doors. It is not a grid, so it carries no roving coordinate of its
// own; selecting a row moves the shared coordinate's dimension so the shell's
// readout keeps following.
import { Button } from '@/features/shared/components/buttons';
import { Hint } from '@/features/shared/components/kit';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { inkOf } from '../../atlasModel';
import { InkDot } from '../../AtlasParts';
import { ATLAS_WORDS as W } from '../../atlasWords';
import type { AtlasFigureProps } from '../../atlasFigure';

/** How many projects a row names before it counts the rest. */
const NAMED = 4;
/** The table is WINDOWED: `rowHeight` is UnifiedTable's bound on how many rows
 *  may enter the DOM (long-list-rendering). The lens's dimension list is short
 *  today, but the bound belongs on the call, not on today's data. */
const ROW_H = 38;

interface LedgerRow {
  key: string;
  di: number;
  label: string;
  info: string;
  below: { pi: number; slug: string; name: string }[];
  attention: number;
  healthy: number;
  unverified: number;
}

const COUNT_W = '84px';

export function LedgerFigure({ projects, rows, names, at, onMove, onOpenCell, onOpenProject }: AtlasFigureProps) {
  const data: LedgerRow[] = rows.map((r, di) => {
    const below: LedgerRow['below'] = [];
    let attention = 0, healthy = 0, unverified = 0;
    projects.forEach((p, pi) => {
      const ink = inkOf(p, r);
      if (ink === 'bad') below.push({ pi, slug: p.identity.slug, name: names.get(p.identity.slug)?.name ?? p.identity.name });
      else if (ink === 'warn') attention += 1;
      else if (ink === 'good') healthy += 1;
      else if (ink === 'unknown') unverified += 1;
    });
    return { key: r.key, di, label: r.label, info: r.info, below, attention, healthy, unverified };
  });

  const num = (key: string, label: string, ink: 'warn' | 'good' | 'unknown', pick: (r: LedgerRow) => number): TableColumn<LedgerRow> => ({
    key, label, width: COUNT_W, sortable: true,
    sortFn: (a, b) => pick(a) - pick(b),
    render: (r) => (
      <span className="atlas-ledger__num typo-caption tabular-nums">
        {pick(r) > 0 ? <InkDot ink={ink} /> : null}{pick(r)}
      </span>
    ),
  });

  const columns: TableColumn<LedgerRow>[] = [
    {
      key: 'dimension', label: W.dimension, width: 'minmax(170px, 1.2fr)', sortable: true,
      render: (r) => (
        <Hint content={r.info} placement="bottom">
          <span className="atlas-ledger__dim typo-label">{r.label}</span>
        </Hint>
      ),
    },
    {
      key: 'below', label: W.below2, width: COUNT_W, sortable: true,
      sortFn: (a, b) => a.below.length - b.below.length,
      render: (r) => (
        <span className="atlas-ledger__num typo-data tabular-nums">
          {r.below.length > 0 ? <InkDot ink="bad" /> : null}{r.below.length}
        </span>
      ),
    },
    num('attention', W.attention, 'warn', (r) => r.attention),
    num('healthy', W.healthy, 'good', (r) => r.healthy),
    num('unverified', W.unverified, 'unknown', (r) => r.unverified),
    {
      key: 'who', label: W.projectsBelow, width: 'minmax(220px, 2fr)',
      render: (r) => r.below.length === 0
        ? <span className="typo-caption">{W.noneBelow}</span>
        : (
          <span className="atlas-ledger__who">
            {r.below.slice(0, NAMED).map((b) => (
              <Button
                key={b.slug}
                variant="ghost"
                size="sm"
                className="atlas-ledger__who-btn"
                onClick={(e) => { e.stopPropagation(); onMove({ pi: b.pi, di: r.di }); onOpenCell({ pi: b.pi, di: r.di }); }}
                onDoubleClick={(e) => { e.stopPropagation(); onOpenProject(b.slug); }}
                data-testid={`atlas-ledger-${r.key}-${b.slug}`}
              >
                <span className="k-ellipsis">{b.name}</span>
              </Button>
            ))}
            {r.below.length > NAMED && <span className="typo-caption tabular-nums">{W.more(r.below.length - NAMED)}</span>}
          </span>
        ),
    },
  ];

  return (
    <div className="atlas-ledger" data-testid="atlas-ledger">
      <UnifiedTable
        columns={columns}
        data={data}
        getRowKey={(r) => r.key}
        onRowClick={(r) => onMove({ pi: at.pi, di: r.di })}
        rowHeight={ROW_H}
        className="h-full"
        scrollRestoreKey={`atlas-ledger|${rows.map((r) => r.key).join(',')}`}
        rowAccent={(r) => (r.di === at.di ? 'border-l-primary' : undefined)}
        ariaLabel={W.ledgerLabel}
        tableId="atlas-ledger"
        defaultSortKey="below"
        emptyTitle={W.allClear}
        borderless
      />
    </div>
  );
}
