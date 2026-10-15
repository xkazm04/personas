// One charter on the Stewards plate, in the rail's row grammar (a Usage plan
// row, `PlanPlates`): ONE line - the project's name, its spend as the Usage
// plate's thin bar against the cap (dashed when there is no cap or no
// reading), the open asks as a right-aligned figure, and the lamp. The lamp is
// lit only while the mandate holds something for the operator: amber while
// the steward asks, blue for a draft waiting to be signed, dark otherwise; a
// suspended mandate is struck. Everything else (steward, rung, mode, held,
// spend in figures) is in the row's tooltip. Pressing it opens the mandate.
//
// The bar's lit length is what is SPENT (a cap fills up), the register's
// reading of the same meter (`mandate/rowParts` SpendBar): amber past 85%,
// red at the cap.

import type { AutopilotMode } from '@/api/devTools/autopilot';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { MandateSummary } from '@/lib/bindings/MandateSummary';
import { Lamp } from '../parts';
import { toneClass, type Lamp as LampModel, type Tone } from '../tone';
import { StewardTip } from '../stewards/StewardTip';

export function stewardLamp(m: MandateSummary): LampModel {
  if (m.status === 'suspended') return { tone: 'off', lit: false };
  if ((m.load.openAsks ?? 0) > 0) return { tone: 'warn', lit: true };
  if (m.status === 'draft') return { tone: 'info', lit: true };
  return { tone: 'run', lit: false };
}

/** Spend bands, the same as the register's meter: amber past this share of the cap, red at the cap. */
const SPEND_WARN_SHARE = 0.85;
const SPEND_FULL_SHARE = 1;

function spendTone(share: number): Tone {
  if (share >= SPEND_FULL_SHARE) return 'err';
  return share > SPEND_WARN_SHARE ? 'warn' : 'run';
}

function SpendMeter({ used, cap }: { used: number | null; cap: number | null }) {
  const share = used !== null && cap !== null && cap > 0 ? Math.min(1, used / cap) : null;
  const tone = share === null ? null : spendTone(share);
  return (
    <span className={`ae-bar w-12 flex-shrink-0 ${tone ? toneClass(tone) : 'is-empty'}`} aria-hidden>
      {share !== null && <i style={{ width: `${Math.max(share * 100, 2)}%` }} />}
    </span>
  );
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
  const { spendUsedUsd: used, budgetUsd: cap, openAsks } = mandate.load;
  const asking = (openAsks ?? 0) > 0;
  const suspended = mandate.status === 'suspended';

  return (
    <Tooltip
      placement="right"
      delay={400}
      content={<StewardTip mandate={mandate} mode={mode} modeKnown={modeKnown} held={held} />}
    >
      <Button
        variant="ghost"
        size="xs"
        onClick={() => onOpen(mandate.charterId)}
        aria-label={tx(m.ml_steward_row_aria, { project })}
        data-testid="fleet-steward-row"
        data-charter={mandate.charterId}
        data-status={mandate.status}
        className="ae-plan ae-focus"
      >
        <span className="flex w-full min-w-0 items-center gap-2">
          <span className={`min-w-0 flex-1 truncate typo-caption text-foreground ${suspended ? 'line-through decoration-foreground/40' : ''}`}>
            {project}
          </span>
          <SpendMeter used={used} cap={cap} />
          <span className={`w-5 flex-shrink-0 text-right typo-data tabular-nums ${asking ? 'text-status-warning' : 'text-foreground'}`}>
            {openAsks === null ? '?' : asking ? <Numeric value={openAsks} /> : null}
          </span>
          <Lamp lamp={stewardLamp(mandate)} />
        </span>
      </Button>
    </Tooltip>
  );
}
