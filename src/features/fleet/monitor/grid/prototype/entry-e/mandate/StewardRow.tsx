// One charter on the Stewards plate: the project and its steward, then the
// envelope's load on one line (rung, the project's autopilot mode, budget
// used / cap or "no cap", open asks, held items). The row is a lamp: lit amber
// while the steward has asks open, blue for a draft waiting to be signed,
// dark otherwise; a suspended mandate is struck dark. Pressing it opens the
// mandate page (`M` opens the register).

import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { AutopilotMode } from '@/api/devTools/autopilot';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Lamp, Segments } from '../parts';
import type { Lamp as LampModel } from '../tone';
import { modeLabel, statusLabel } from './mandateCopy';

const BUDGET_SEGS = 10;

export function stewardLamp(m: MandateSummary): LampModel {
  if (m.status === 'suspended') return { tone: 'off', lit: false };
  if ((m.load.openAsks ?? 0) > 0) return { tone: 'warn', lit: true };
  if (m.status === 'draft') return { tone: 'info', lit: true };
  return { tone: 'run', lit: false };
}

export function StewardRow({ mandate, mode, modeKnown, held, onOpen }: {
  mandate: MandateSummary;
  mode: AutopilotMode | null;
  /** False when the mode read failed: shown as unknown, never as `off`. */
  modeKnown: boolean;
  /** Items held on this charter; null when the lanes snapshot is not read. */
  held: number | null;
  onOpen: (charterId: string) => void;
}) {
  const { t, tx } = useTranslation();
  const m = t.monitor;
  const project = mandate.projectName ?? m.ml_project_unknown;
  const steward = mandate.stewardName ?? m.ml_steward_unknown;
  const { spendUsedUsd: used, budgetUsd: cap, openAsks } = mandate.load;
  const pct = used !== null && cap !== null && cap > 0 ? Math.min(1, used / cap) : null;
  const lamp = stewardLamp(mandate);

  return (
    <Tooltip content={tx(m.ml_steward_row_aria, { project })} placement="right" delay={500}>
      <Button
        variant="ghost"
        onClick={() => onOpen(mandate.charterId)}
        aria-label={tx(m.ml_steward_row_aria, { project })}
        data-testid="fleet-steward-row"
        data-charter={mandate.charterId}
        data-status={mandate.status}
        className="ae-focus w-full min-w-0 rounded-input px-2 py-1.5 text-left [&>span]:flex [&>span]:w-full [&>span]:min-w-0 [&>span]:flex-col [&>span]:gap-1"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`min-w-0 flex-1 truncate typo-body text-foreground ${mandate.status === 'suspended' ? 'line-through decoration-foreground/40' : ''}`}>{project}</span>
          {mandate.status !== 'active' && <span className="flex-shrink-0 typo-caption">{statusLabel(m, mandate.status)}</span>}
          <Lamp lamp={lamp} />
        </span>
        <span className="truncate typo-caption text-foreground">{steward}</span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 typo-caption">
          <span>{tx(m.ml_steward_rung, { rung: mandate.scopeRung })}</span>
          <span>{modeKnown ? modeLabel(m, mode) : m.ml_steward_mode_unknown}</span>
          <span className={(openAsks ?? 0) > 0 ? 'text-status-warning' : ''}>
            {openAsks === null ? m.ml_steward_asks_unknown : tx(m.ml_steward_asks, { count: openAsks })}
          </span>
          {held !== null && held > 0 && <span>{tx(m.ml_steward_held, { count: held })}</span>}
        </span>
        <span className="flex min-w-0 items-center gap-2 typo-caption tabular-nums">
          {pct !== null && <Segments className="w-14 flex-shrink-0" count={BUDGET_SEGS} lit={pct * BUDGET_SEGS} tone={pct > 0.85 ? 'warn' : 'run'} thin />}
          <span className="min-w-0">
            {cap === null ? m.ml_steward_no_cap : used === null ? m.ml_steward_spend_unknown : (
              <><Numeric value={used} unit="usd" /> / <Numeric value={cap} unit="usd" /></>
            )}
          </span>
        </span>
      </Button>
    </Tooltip>
  );
}
