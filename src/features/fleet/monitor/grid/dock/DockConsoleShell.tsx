// DockConsoleShell — variant 2 of 3: CONTROLS FIRST.
//
// The same blocks as `DockRail`, in the inverted priority. The toolbar is the
// top band — the operator meets the dispatch's parameters before its price —
// and the four readings drop to the line immediately above the field, sharing
// it with the target path. The readings are then as close to the launch as
// they can get without being in the command row, which is the argument for
// this arrangement: you read the cost in the same glance as the objective.
//
// Visually it is the tighter of the three: the toolbar sits on a tinted band
// closed by a hairline, so the console reads as a control surface with a field
// under it rather than as a stack of equal rows.
//
// Reserved heights: 34 / 30 / 24 / 66 / 20. None of them is conditional.

import { DockChipRail, DockCommandRow, DockMetaRow } from './DockCommandRow';
import { DockCollapse, DockReadout, DockTarget, DockVariantPanel, DockVariantSwitch } from './DockParts';
import { DockToolbar } from './DockToolbar';
import type { DockShellProps } from './dockShell';

export function DockConsoleShell({ console: d, variant, onVariantChange }: DockShellProps) {
  return (
    <>
      {/* 1 — TOOLBAR BAND (34px): every parameter and every toggle, plus the
          shell chrome, on a tinted strip closed by a hairline. */}
      <div className="relative z-[1] flex h-[34px] items-center gap-2 border-b border-border bg-foreground/[0.02] px-3" data-dock-row>
        <DockToolbar console={d} className="flex-1" />
        <DockVariantSwitch value={variant} onChange={onVariantChange} />
        <DockCollapse onClick={d.collapse} />
      </div>

      <DockVariantPanel variant={variant}>
        {/* 2 — MANIFEST (30px): where it lands, and the three readings, right
            above the field they are about. */}
        <div className="relative z-[1] flex h-[30px] items-center gap-2 px-3" data-dock-row>
          <DockTarget console={d} />
          <DockReadout console={d} />
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
