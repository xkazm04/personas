/**
 * The Cockpit's ONE table — `UnifiedTable`, the table every other surface in the app already uses.
 *
 * Owner, 2026-10-03: *"Remove column 'detail' from the table, reuse components to render table we
 * should share across the app (`src/features/overview/sub_events/components/EventLogList.tsx`).
 * Not needed to divide the days into groups in this situation."* Asked whether `UnifiedTable` or
 * the kit's `Rows columns` should win: **"UnifiedTable everywhere, retire kit Rows columns."**
 *
 * So the Cockpit's lists are now `UnifiedTable`s, modelled on `EventLogList`: a column model of
 * `TableColumn`s, `data` + `isLoading` handing the whole cold-load contract to the table, cells
 * that ellipsize so a row never grows a second line (Gate 2b). What the port deliberately does
 * NOT take from `EventLogList`:
 *
 * - **no `groupBy`** — the owner said day groups are not needed here, and a widget's rows are
 *   ranked by Athena, not chronological;
 * - **no windowing** — `rowHeight={0}` is passed EXPLICITLY, and the reason is the one
 *   `long-list-rendering.md` asks a call site to write down. `UnifiedTable` windows rows only by
 *   giving itself a bounded scroll container, and a kit `Tile` forbids exactly that (`Tiles`:
 *   "no row span and no inner scroll: the content decides the height; the page scrolls"). So the
 *   bound is applied BEFORE the data reaches the table instead: `cap` (defaulted, never absent)
 *   slices the rows, and the only way past it is the user pressing "Show all N" — which is what
 *   home-2 accepted, at forty. A widget whose row count comes out of a language model is
 *   therefore bounded by construction, not by the composer's restraint;
 * - **no `tableId`** — a composed widget's columns are not the user's to resize or re-sort, and a
 *   per-widget localStorage key would accumulate one entry per composition.
 *
 * What a tile keeps from the kit: the `Tile` itself, its head, mark, footer and empty band, the
 * `Stack` regions, and the capped "Show all N" below the rows, which `Rows cap` used to own and
 * `UnifiedTable` has no equivalent for (home-2: *"cap + Show all at 40 are ACCEPTED"*).
 *
 * A row's MEANING was the kit `Mark` on the spine; here it is the table's left `rowAccent` in the
 * same tone, with the mark's label kept as the row's `sr-only` name prefix (see `nameCell`) so
 * nothing that was spoken stops being spoken.
 */
import { useCallback, useState, type ReactNode } from 'react';

import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { Hint, KitButton, type Tone } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

export type { TableColumn };

/**
 * A row's tone as the table's left accent: the kit `Mark`'s spine, in `UnifiedTable`'s vocabulary.
 * `neutral` draws the faintest rule rather than nothing, so an unmarked row still reads as a row.
 */
export const ROW_ACCENT: Record<Tone, string> = {
  primary: 'border-l-primary',
  success: 'border-l-status-success/70',
  warning: 'border-l-status-warning/70',
  error: 'border-l-status-error/70',
  info: 'border-l-status-info/70',
  pending: 'border-l-status-warning/45',
  neutral: 'border-l-primary/15',
  agent: 'border-l-role-agent/70',
  human: 'border-l-role-human/70',
  external: 'border-l-role-external/70',
  highlight: 'border-l-role-highlight/70',
};

/** A toned value's ink. Colour by meaning, never a hue (`.claude/rules/ui.md`). */
const TONE_TEXT: Record<Tone, string> = {
  primary: 'text-primary',
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  info: 'text-status-info',
  pending: 'text-status-warning',
  neutral: 'text-foreground',
  agent: 'text-role-agent',
  human: 'text-role-human',
  external: 'text-role-external',
  highlight: 'text-role-highlight',
};

/**
 * One cell's value: ONE line, ellipsized, never wrapping the row taller (Gate 2b).
 *
 * `hint` carries on hover and focus what the cell does NOT show - the full rationale behind a
 * shortened one, the condition behind a grain (grow-2: explanatory scaffolding stays off the
 * surface). A hint EQUAL to the visible text is dropped: `Hint` always puts its content in the
 * tree as the trigger's `aria-describedby` node, so an echo would make a reader hear the same
 * words twice and would duplicate the text for anything reading the DOM.
 */
export function Cell({ value, hint, tone, data, strong }: {
  value: ReactNode;
  hint?: string | null;
  tone?: Tone;
  /** A figure rather than prose: the tabular type scale. */
  data?: boolean;
  /** The row's one emphasis — the name column only. */
  strong?: boolean;
}) {
  if (value == null || value === '') return null;
  const ink = tone ? TONE_TEXT[tone] : 'text-foreground';
  const adds = hint && hint !== (typeof value === 'string' ? value : null) ? hint : null;
  const node = (
    // `k-medium` (500), not `font-medium`: the kit's own weight class, which `typo-token-overpainted`
    // does not count as a local variant of a type recipe — and 500 IS the kit's recipe for a white
    // name (grow-4 part 5; 600 belongs to the tinted title above it).
    <span className={`block min-w-0 truncate ${data ? 'typo-data' : 'typo-body'} ${strong ? 'k-medium' : 'k-regular'} ${ink}`}>
      {value}
    </span>
  );
  return adds ? <Hint content={adds}>{node}</Hint> : node;
}

/**
 * The name cell: the row's one emphasis, with the tone's label spoken before it when the tone is
 * only drawn (the left accent carries no text of its own, where the kit `Mark` carried a label).
 */
export function nameCell(value: ReactNode, spoken?: string, hint?: string | null): ReactNode {
  return (
    <>
      {spoken && <span className="sr-only">{`${spoken}: `}</span>}
      <Cell value={value} hint={hint} strong />
    </>
  );
}

/**
 * The bound a Cockpit table takes when its caller names none. Eight is home-2's accepted range for
 * a grid list ("grid lists cap at 6-8"), and a widget's rows are already ranked by Athena, so the
 * first eight are the ones that matter.
 */
export const DEFAULT_CAP = 8;

export interface WidgetTableProps<T> {
  columns: TableColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** The row's meaning, drawn as the table's left accent. */
  rowTone?: (row: T) => Tone;
  /** Already-translated, surface-specific (never "No data"). */
  emptyTitle: string;
  /** Accessible name of the table and of its "Show all" pager. */
  label: string;
  /**
   * Show the first `cap` rows and a "Show all N" that expands in place (home-2 contract). This is
   * the table's ONLY bound on how many rows enter the DOM (see the note on windowing above), so
   * it is never absent: a caller that names none gets {@link DEFAULT_CAP}.
   */
  cap?: number;
  isLoading?: boolean;
  testId?: string;
}

/**
 * A Cockpit widget's rows as one `UnifiedTable`, inset onto the kit's reading line so a column
 * head lines up under the tile's own title, with the capped "Show all N" under the last row.
 */
export function WidgetTable<T>({
  columns, rows, getRowKey, onRowClick, rowTone, emptyTitle, label, cap = DEFAULT_CAP, isLoading, testId,
}: WidgetTableProps<T>) {
  const { t, tx } = useTranslation();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState('');
  const capped = rows.length > cap;
  const shown = capped && !open ? rows.slice(0, cap) : rows;
  const toggle = useCallback(() => {
    setOpen((was) => {
      const next = !was;
      setSaid(next
        ? tx(t.shared.rows_showing_all, { count: rows.length })
        : tx(t.shared.rows_showing_first, { count: cap }));
      return next;
    });
  }, [cap, rows.length, t.shared.rows_showing_all, t.shared.rows_showing_first, tx]);
  const accent = useCallback(
    (row: T) => (rowTone ? ROW_ACCENT[rowTone(row)] : undefined),
    [rowTone],
  );

  return (
    <div className="flex flex-col min-w-0 flex-1" data-testid={testId}>
      {/* The cells' own px-4 plus this inset puts a value's first glyph on the kit reading line
          (`--gutter`), so the table's first column starts where the tile's title does. */}
      <div className="min-w-0" style={{ paddingLeft: 'calc(var(--gutter) - 16px)', paddingRight: 12 }}>
        <UnifiedTable<T>
          columns={columns}
          data={shown as T[]}
          getRowKey={getRowKey}
          onRowClick={onRowClick}
          rowAccent={rowTone ? accent : undefined}
          emptyTitle={emptyTitle}
          isLoading={isLoading}
          density="compact"
          borderless
          stickyHeader={false}
          ariaLabel={label}
          // Deliberately NOT windowed, and this is the written reason the ratchet asks for: a Tile
          // has no inner scroll to window against, so the bound is `cap` above, applied to the
          // data before it ever reaches the table.
          rowHeight={0}
        />
      </div>
      {capped && (
        <nav className="k-pager" aria-label={label}>
          <KitButton tone="quiet" expanded={open} onClick={toggle}>
            {open ? t.shared.rows_show_fewer : tx(t.shared.rows_show_all, { count: rows.length })}
          </KitButton>
          <span className="sr-only" role="status">{said}</span>
        </nav>
      )}
    </div>
  );
}
