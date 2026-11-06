import type { ReactNode } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { StateMark, type StateMarkState } from '@/features/shared/components/display/StateMark';
import { formatDuration, formatRelativeTime, getStatusEntry } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';
import { isInFlightExecutionStatus } from '../../libs/executionStatus';

/**
 * The cell vocabulary shared by BOTH execution ledgers — the persona run list
 * (`sub_executions/components/list/ExecutionList`) and the all-persona
 * Overview activity list (`overview/sub_activity/GlobalExecutionList`). One
 * definition so a status pill, an unknown cost or a relative timestamp can
 * never render two different ways across the two surfaces.
 *
 * ONE TYPE SCALE ACROSS EVERY VALUE CELL (2026-10-04, owner: "has for each
 * column values different font type and size. Sync with EventLogList"). The
 * model name, the duration, the start time and an unknown cost were all
 * `font-mono` while the persona name and a known cost were sans, so four of a
 * ledger's six columns rendered in a different family from the other two — and
 * the cost column alone switched family on the value ($0.18 sans, "—" mono).
 * Every value cell is now `typo-body text-ink-1`, matching the surface the
 * owner named as the model (`overview/sub_events/eventLogColumns.tsx`).
 *
 * The row's ONE emphasis (Gate 3b) is the status pill, and it is carried by
 * weight + tint, not by family: `typo-title` is the step-1 / 600 tier, with
 * `badgeClass`'s `text-status-*` deliberately replacing the token's own primary
 * tint. It was `typo-heading` — the same size at 700 with the 0.025em tracking
 * of a SECTION head, which is display styling inside a 56px row.
 */

const EM_DASH = '—';

/** Per-status left accent for `UnifiedTable`'s `rowAccent`. */
export function executionRowAccent(status: string): string {
  if (isInFlightExecutionStatus(status)) return 'border-l-status-info';
  if (status === 'completed') return 'border-l-transparent';
  if (status === 'failed') return 'border-l-status-error';
  return 'border-l-status-warning';
}

function executionMarkState(status: string): StateMarkState {
  if (isInFlightExecutionStatus(status)) return 'running';
  if (status === 'completed') return 'success';
  if (status === 'failed') return 'error';
  if (status === 'cancelled') return 'skipped';
  return 'warning';
}

/** Status mark: glyph + mono word (no pill). The running glyph is the hatched bar. */
export function ExecutionStatusPill({ status }: { status: string }) {
  const entry = getStatusEntry(status);
  return <StateMark state={executionMarkState(status)} label={entry.label} />;
}

/** A value cell: the ledger's one type scale, never wrapping (Gate 2b — row
 *  height is on an 8px rhythm, so a long value ellipsizes rather than growing
 *  its row). `font-data` is a font-FEATURE preset (tabular + lining figures),
 *  not a size or a weight: it keeps a right-aligned column of numbers on one
 *  vertical axis, which is why `Numeric` already carries it. */
function Cell({ children, figures = false }: { children: ReactNode; figures?: boolean }) {
  return (
    <span className={`${figures ? 'typo-data' : 'typo-body'} text-ink-1 whitespace-nowrap`}>
      {children}
    </span>
  );
}

/**
 * Unknown cost and zero cost both read as an em dash; neither is ever rendered
 * as a real $0.00 (census rule `unknown-money-as-zero`).
 */
export function ExecutionCostCell({ cost }: { cost: number | null | undefined }) {
  const { language } = useTranslation();
  // Both branches are the same family and size; only the figures differ, so the
  // column does not change typeface when a run never recorded its cost.
  if (cost == null || cost <= 0) return <Cell figures>{EM_DASH}</Cell>;
  return <Numeric value={cost} unit="usd" language={language} align="right" className="typo-data text-ink-1" />;
}

export function ExecutionDurationCell({ ms }: { ms: number | null | undefined }) {
  return <Cell figures>{formatDuration(ms ?? null)}</Cell>;
}

export function ExecutionStartedCell({ startedAt, createdAt }: { startedAt: string | null; createdAt: string }) {
  return <Cell figures>{formatRelativeTime(startedAt || createdAt)}</Cell>;
}

/** Input / output token pair, compact. */
export function ExecutionTokensCell({ input, output, format }: { input: number; output: number; format: (n: number) => string }) {
  if (input === 0 && output === 0) return <Cell figures>{EM_DASH}</Cell>;
  return <Cell figures>{format(input)} / {format(output)}</Cell>;
}

/** Sort comparator over the run's effective start time. */
export function byStartTime<T>(pick: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => new Date(pick(a)).getTime() - new Date(pick(b)).getTime();
}
