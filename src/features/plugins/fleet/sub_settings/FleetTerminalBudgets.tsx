import { useEffect, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { getFleetTerminalStats, type FleetTerminalStats } from '../fleetTerminalManager';

/**
 * The manager's budget bookkeeping, on screen.
 *
 * `getFleetTerminalStats()` was written and unit-tested as the early-warning
 * instrument for a MAX_PARKED / MAX_WEBGL set too low, and until this row its
 * only caller in the whole tree was its own test file. Its docblock prescribed
 * reading `__fleetTerminalEvictions__` from a devtools console: the one thing a
 * packaged Tauri build does not hand the operator. So the discriminating number
 * existed in memory during exactly the report it was built for ("my terminals
 * keep going blank and replaying") and no surface displayed it, leaving triage
 * to guesswork.
 *
 * Deliberately NOT behind `import.meta.env.DEV`: gating the only readout of a
 * packaged build's budgets to builds that already have a console would restate
 * the defect rather than fix it. The numbers are read from memory, so the poll
 * costs nothing; 2s is fast enough to watch a budget being hit while switching
 * tiles in another window.
 */
export function TerminalBudgets() {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const [stats, setStats] = useState<FleetTerminalStats>(getFleetTerminalStats);

  useEffect(() => {
    const id = setInterval(() => setStats(getFleetTerminalStats()), 2_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="border-t border-primary/10 pt-3" data-testid="fleet-terminal-budgets">
      <p className="typo-title">{f.settings_budgets_title}</p>
      <p className="typo-caption mb-1.5">{f.settings_budgets_desc}</p>
      <dl className="space-y-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="typo-body text-foreground">{f.settings_budgets_terminals}</dt>
          <dd className="typo-data text-foreground" data-testid="fleet-budget-terminals">
            {tx(f.settings_budgets_terminals_value, {
              live: stats.live,
              parked: stats.parked,
              max: stats.maxParked,
              dropped: stats.evictions,
            })}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="typo-body text-foreground">{f.settings_budgets_renderers}</dt>
          <dd className="typo-data text-foreground" data-testid="fleet-budget-renderers">
            {tx(f.settings_budgets_renderers_value, {
              active: stats.webglContexts,
              max: stats.maxWebgl,
              dropped: stats.webglEvictions,
            })}
          </dd>
        </div>
      </dl>
    </div>
  );
}
