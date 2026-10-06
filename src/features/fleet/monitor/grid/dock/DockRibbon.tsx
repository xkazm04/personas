// DockRibbon — variant 3 of 3: ACT, THEN CONFIRM.
//
// The one arrangement that does not put the readings above the field. The
// toolbar is a ribbon across the top, the objective and the launch sit in a
// strongly framed well directly under it, and the four readings become a
// FOOTER strip beneath the well, where the eye lands on the way to the launch
// button rather than before it has read the objective.
//
// The argument for it: the readout is a PRE-FLIGHT CONFIRMATION, not a
// heading. A price quoted above an empty field is a dash; a price quoted
// under a written objective is the last thing checked before the trigger. The
// argument against it — the readings are further from the top of the dock and
// easier to miss on a glance — is exactly what the blind pick is for.
//
// Reserved heights: 34 / 24 / 66 / 26 / 20. None of them is conditional.

import { DockChipRail, DockCommandRow, DockMetaRow } from './DockCommandRow';
import { DockCollapse, DockReadout, DockTarget, DockVariantPanel, DockVariantSwitch } from './DockParts';
import { DockToolbar } from './DockToolbar';
import type { DockShellProps } from './dockShell';

export function DockRibbon({ console: d, variant, onVariantChange }: DockShellProps) {
  return (
    <>
      {/* 1 — RIBBON (34px): every parameter and every toggle, plus the shell
          chrome, on the band that opens the console. */}
      <div className="relative z-[1] flex h-[34px] items-center gap-2 px-3" data-dock-row>
        <DockToolbar console={d} className="flex-1" />
        <DockVariantSwitch value={variant} onChange={onVariantChange} />
        <DockCollapse onClick={d.collapse} />
      </div>

      <DockVariantPanel variant={variant}>
        {/* 2 — CHIPS (24px): always mounted, chips or empty. */}
        <DockChipRail console={d} />

        {/* 3 — COMMAND (66px): the objective and the launch, one row, framed
            harder than in the other two because here it is the centre. */}
        <DockCommandRow console={d} frameClassName="shadow-elevation-1" />

        {/* 4 — FOOTER (26px): the four readings, read last, on the way to the
            trigger rather than before the objective exists. */}
        <div className="relative z-[1] flex h-[26px] items-center gap-2 px-3 pt-1" data-dock-row>
          <DockTarget console={d} />
          <DockReadout console={d} />
        </div>

        {/* 5 — META (20px): a fixed-height swap slot, never a mount. */}
        <DockMetaRow console={d} />
      </DockVariantPanel>
    </>
  );
}
