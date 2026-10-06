// DockRail — variant 1 of 3: READINGS FIRST.
//
// The lineage variant. The Launch Rail won a blind contest on its readout, and
// this shell keeps that readout where it won: on its own manifest line at the
// very top, above everything, so WHERE this lands / WHAT IT COSTS / IS IT
// READY / WHERE IN THE LINE are the first things on the console and the
// controls that change them sit directly underneath.
//
// What it changes from the shell it descends from is only what the operator
// ruled on: the parameters and toggles are now ONE toolbar strip instead of
// being scattered down the left gutter and along a footer, the objective and
// the launch are ONE row, and the launch's arrow and its word are on one line.
//
// Reserved heights: 30 / 34 / 24 / 66 / 20. None of them is conditional.

import { DockChipRail, DockCommandRow, DockMetaRow } from './DockCommandRow';
import { DockCollapse, DockReadout, DockTarget, DockVariantPanel, DockVariantSwitch } from './DockParts';
import { DockToolbar } from './DockToolbar';
import type { DockShellProps } from './dockShell';

export function DockRail({ console: d, variant, onVariantChange }: DockShellProps) {
  return (
    <>
      {/* 1 — MANIFEST (30px): the four readings, and the shell chrome. */}
      <div className="relative z-[1] flex h-[30px] items-center gap-2 px-3" data-dock-row>
        <DockTarget console={d} />
        <DockReadout console={d} />
        <DockVariantSwitch value={variant} onChange={onVariantChange} />
        <DockCollapse onClick={d.collapse} />
      </div>

      <DockVariantPanel variant={variant}>
        {/* 2 — TOOLBAR (34px): every parameter and every toggle, one line. */}
        <div className="relative z-[1] flex h-[34px] items-center px-3" data-dock-row>
          <DockToolbar console={d} className="flex-1" />
        </div>

        {/* 3 — CHIPS (24px): always mounted, chips or empty. */}
        <DockChipRail console={d} />

        {/* 4 — COMMAND (66px): the objective and the launch, one row. */}
        <DockCommandRow console={d} />

        {/* 5 — META (20px): a fixed-height swap slot, never a mount. */}
        <DockMetaRow console={d} />
      </DockVariantPanel>
    </>
  );
}
