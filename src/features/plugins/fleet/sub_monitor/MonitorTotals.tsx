import { useMemo } from 'react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import { attentionLane } from './monitorMeta';
import type { MonitorTerminal } from './monitorTypes';

interface Totals {
  sessions: number;
  working: number;
  needsYou: number;
  procs: number;
  subagents: number;
  outputTokens: number;
  memGb: number;
}

/**
 * Fleet-wide aggregates.
 *
 * Lane counts read off session state, so every session counts. The MEASURED
 * sums (procs, subagents, tokens, memory) skip `simulated` rows: those numbers
 * are a deterministic placeholder for sessions with no bound transcript, and
 * folding them into a total would quietly turn a placeholder into a fleet fact.
 */
export function monitorTotals(fleet: MonitorTerminal[]): Totals {
  const totals: Totals = {
    sessions: fleet.length, working: 0, needsYou: 0, procs: 0, subagents: 0, outputTokens: 0, memGb: 0,
  };
  let memMb = 0;
  for (const term of fleet) {
    const lane = attentionLane(term);
    if (lane === 'working') totals.working += 1;
    if (lane === 'needs_you') totals.needsYou += 1;
    if (term.simulated) continue;
    totals.procs += term.subprocs;
    totals.subagents += term.subagentsActive;
    totals.outputTokens += term.outputTokens;
    memMb += term.memMb;
  }
  totals.memGb = memMb / 1024;
  return totals;
}

function Total({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <Numeric className={`typo-caption ${tone ?? 'text-foreground'}`}>{children}</Numeric>
      <span className="typo-caption text-foreground opacity-50">{label}</span>
    </span>
  );
}

/** One-line fleet summary above the ledger. */
export function MonitorTotals({ fleet }: { fleet: MonitorTerminal[] }) {
  const { t } = useTranslation();
  const totals = useMemo(() => monitorTotals(fleet), [fleet]);
  const f = t.plugins.fleet;

  return (
    <div
      className="flex items-center gap-4 px-4 py-1.5 border-b border-primary/10 shrink-0"
      role="group"
      aria-label={f.monitor_totals_aria}
      title={f.monitor_totals_hint}
    >
      <Total label={f.monitor_totals_sessions}>{totals.sessions}</Total>
      <Total label={f.monitor_totals_working} tone="text-blue-300">{totals.working}</Total>
      <Total label={f.monitor_totals_needs_you} tone={totals.needsYou > 0 ? 'text-violet-300' : undefined}>
        {totals.needsYou}
      </Total>
      <span className="w-px h-3 bg-primary/15" aria-hidden="true" />
      <Total label={f.monitor_totals_procs}>{totals.procs}</Total>
      <Total label={f.monitor_totals_subagents} tone={totals.subagents > 0 ? 'text-status-info' : undefined}>
        {totals.subagents}
      </Total>
      <Total label={f.monitor_totals_tokens}>
        <Numeric value={totals.outputTokens} unit="compact" />
      </Total>
      <Total label={f.monitor_totals_mem}>
        <Numeric value={totals.memGb} precision={1} />
      </Total>
    </div>
  );
}
