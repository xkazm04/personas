// The detail of one steward row, laid out the way the Schedules plate lays out
// a task (`SchedulePlate` TaskTip): the project as the title, then one short
// line per fact - who stewards it and its status, rung and autopilot mode,
// what it holds for the operator, and spend against the cap. The row itself
// carries only the name, the meter and the asks figure.

import type { AutopilotMode } from '@/api/devTools/autopilot';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { modeLabel, statusLabel } from '../mandate/mandateCopy';

export function StewardTip({ mandate, mode, modeKnown, held }: {
  mandate: MandateSummary;
  mode: AutopilotMode | null;
  modeKnown: boolean;
  held: number | null;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const { spendUsedUsd: used, budgetUsd: cap, openAsks } = mandate.load;
  const asks = openAsks === null ? m.ml_steward_asks_unknown : tx(m.ml_steward_asks, { count: openAsks });
  return (
    <div className="flex flex-col gap-1 typo-caption">
      <span className="typo-body text-foreground">{mandate.projectName ?? m.ml_project_unknown}</span>
      <span>{mandate.stewardName ?? m.ml_steward_unknown} · {statusLabel(m, mandate.status)}</span>
      <span>{tx(m.ml_steward_rung, { rung: mandate.scopeRung })} · {modeKnown ? modeLabel(m, mode) : m.ml_steward_mode_unknown}</span>
      <span>{held !== null && held > 0 ? `${asks} · ${tx(m.ml_steward_held, { count: held })}` : asks}</span>
      <span className="tabular-nums">
        {cap === null ? m.ml_steward_no_cap : used === null ? m.ml_steward_spend_unknown : (
          <><Numeric value={used} unit="usd" /> / <Numeric value={cap} unit="usd" /></>
        )}
      </span>
    </div>
  );
}
