import type { ReactNode } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { formatDuration, formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * The cell vocabulary shared by BOTH execution ledgers — the persona run list
 * (`sub_executions/components/list/ExecutionList`) and the all-persona
 * Overview activity list (`overview/sub_activity/GlobalExecutionList`). One
 * definition so a status pill, an unknown cost or a relative timestamp can
 * never render two different ways across the two surfaces.
 */

const EM_DASH = '—';

/** Per-status left accent for `UnifiedTable`'s `rowAccent`. */
export function executionRowAccent(status: string): string {
  if (status === 'running' || status === 'pending') return 'border-l-blue-400';
  if (status === 'completed') return 'border-l-emerald-400';
  if (status === 'failed') return 'border-l-red-400';
  return 'border-l-amber-400';
}

/** Status pill with a live ping dot while the run is in flight. */
export function ExecutionStatusPill({ status }: { status: string }) {
  const entry = getStatusEntry(status);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-card typo-heading whitespace-nowrap ${badgeClass(entry)}`}>
      {entry.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500" />
        </span>
      )}
      {entry.label}
    </span>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return <span className="typo-body text-foreground font-mono whitespace-nowrap">{children}</span>;
}

/**
 * Unknown cost and zero cost both read as an em dash; neither is ever rendered
 * as a real $0.00 (census rule `unknown-money-as-zero`).
 */
export function ExecutionCostCell({ cost }: { cost: number | null | undefined }) {
  const { language } = useTranslation();
  if (cost == null || cost <= 0) return <Mono>{EM_DASH}</Mono>;
  return <Numeric value={cost} unit="usd" language={language} align="right" className="typo-body text-foreground" />;
}

export function ExecutionDurationCell({ ms }: { ms: number | null | undefined }) {
  return <Mono>{formatDuration(ms ?? null)}</Mono>;
}

export function ExecutionStartedCell({ startedAt, createdAt }: { startedAt: string | null; createdAt: string }) {
  return <Mono>{formatRelativeTime(startedAt || createdAt)}</Mono>;
}

/** Input / output token pair, compact. */
export function ExecutionTokensCell({ input, output, format }: { input: number; output: number; format: (n: number) => string }) {
  if (input === 0 && output === 0) return <Mono>{EM_DASH}</Mono>;
  return <Mono>{format(input)} / {format(output)}</Mono>;
}

/** Sort comparator over the run's effective start time. */
export function byStartTime<T>(pick: (row: T) => string): (a: T, b: T) => number {
  return (a, b) => new Date(pick(a)).getTime() - new Date(pick(b)).getTime();
}
