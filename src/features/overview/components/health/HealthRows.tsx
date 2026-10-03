import type { HealthCheckItem } from '@/api/system/system';
import { Rows, ListRow, type RowColumn } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';

import { HealthAction, hasAction, type HealthActionDeps } from './HealthActions';
import { bySeverity, sectionLabel, statusMark, type HealthSectionId } from './healthModel';

/** One check with the environment it belongs to, which is what the triage list has to show. */
export interface HealthRow {
  sectionId: HealthSectionId;
  item: HealthCheckItem;
}

export function rowKey(row: HealthRow): string {
  return `${row.sectionId}/${row.item.id}`;
}

/** Worst first, so a capped list still shows the work (`Rows cap` keeps the first N). */
export function sortRowsBySeverity(rows: readonly HealthRow[]): HealthRow[] {
  const flat = bySeverity(rows.map((r) => r.item));
  const order = new Map(flat.map((item, i) => [item, i]));
  return [...rows].sort((a, b) => (order.get(a.item) ?? 0) - (order.get(b.item) ?? 0));
}

/**
 * The checks of one or many environments as a declared-column `Rows` list (grow-4, part 2), shared
 * by all three prototypes (kit batch home-3).
 *
 * **There is no Status column**, and that is deliberate against the batch brief's literal
 * `check / status / detail / action` set: the kit's law is "state is a `Mark`, never a trailing
 * status word" (doctrine 6b), and `ListRow` already puts the mark on the spine at the row's
 * reading line. A Status column would draw the same fact twice, once by meaning and once as a
 * word, and spend a track doing it. The word is not lost: it is the Mark's accessible name, so a
 * reader hears "Failing" where a sighted operator sees the error tone.
 *
 * Every track is fixed or an `fr`, so the columns line up down the list; `Detail` ellipsizes to
 * one line and `Action` holds only the compact form of a control, which is how a 48px row keeps
 * its height whatever the backend writes into `detail` (Gate 2b).
 */
export function HealthRows({ rows, selected, onSelect, showSection, deps, loading, cap, label }: {
  rows: readonly HealthRow[];
  selected?: string | null;
  onSelect?: (row: HealthRow) => void;
  /** Draw the environment each check belongs to: the triage list spans all six. */
  showSection?: boolean;
  deps: HealthActionDeps;
  loading?: boolean;
  cap?: number;
  label: string;
}) {
  const { t } = useTranslation();
  const s = t.system_health;

  const columns: RowColumn[] = [
    ...(showSection ? [{ head: s.col_environment, width: '9rem', collapse: true } satisfies RowColumn] : []),
    { head: s.col_detail, width: '2fr' },
    { head: s.col_action, width: '9.5rem', align: 'end', collapse: true },
  ];

  return (
    <Rows
      count={rows.length}
      loading={loading}
      label={label}
      cap={cap}
      columns={columns}
      nameHead={s.col_check}
      empty={{ title: s.attention_none, hint: s.attention_none_hint, tone: 'success' }}
    >
      {rows.map((row) => (
        <ListRow
          key={rowKey(row)}
          size="s"
          name={row.item.label}
          mark={statusMark(t, row.item.status)}
          state={selected === rowKey(row) ? 'selected' : undefined}
          onPress={onSelect ? () => onSelect(row) : undefined}
          testId={`health-row-${row.sectionId}-${row.item.id}`}
          cells={[
            ...(showSection ? [<span key="env" className="typo-caption">{sectionLabel(t, row.sectionId)}</span>] : []),
            <span key="detail" className="typo-caption">{row.item.detail ?? ''}</span>,
            hasAction(row.item, deps.unavailable)
              ? <HealthAction key="action" item={row.item} deps={deps} compact />
              : null,
          ]}
        />
      ))}
    </Rows>
  );
}
