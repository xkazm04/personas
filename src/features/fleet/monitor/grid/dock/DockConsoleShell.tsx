// DockConsoleShell — the dispatch dock's shell: CONTROLS FIRST.
//
// One of three arrangements built behind a persisted switch (rail / console /
// ribbon) and the one the operator picked, on 2026-10-06; the other two were
// deleted with the switch. The toolbar is the top band — the operator meets
// the dispatch's parameters before its price — and the four readings drop to
// the line immediately above the field, sharing it with the target path. The
// readings are then as close to the launch as they can get without being in
// the command row, which is the argument for this arrangement: you read the
// cost in the same glance as the objective.
//
// Visually it is the tightest arrangement of the three that were tried: the
// toolbar sits on a tinted band closed by a hairline, so the console reads as
// a control surface with a field under it rather than as a stack of equal rows.
//
// Reserved heights: 36 / 28 / 58 / 20. None of them is conditional.
//
// THE PLATE (polish P2, 2026-10-16: "the dock does not fit the monitor"). The
// console is now a plate of the panel's language (`.ae-plate` in
// `QuickDispatchDock`), its controls the command bar's chips (`dockChrome`),
// and it is one row shorter: the chips ride at the head of the manifest row
// instead of holding a 24px row of their own that was empty almost always.

import { DockChips, DockCommandRow, DockMetaRow } from './DockCommandRow';
import { DockCollapse, DockReadout, DockTarget } from './DockParts';
import { DockToolbar } from './DockToolbar';
import type { DockShellProps } from './dockShell';

export function DockConsoleShell({ console: d }: DockShellProps) {
  return (
    <>
      {/* 1 - TOOLBAR (36px): every parameter and every toggle, plus the
          collapse, closed by the plate's hairline. */}
      <div className="relative z-[1] flex h-9 items-center gap-2 border-b border-border px-2" data-dock-row>
        <DockToolbar console={d} className="flex-1" />
        <DockCollapse onClick={d.collapse} />
      </div>

      {/* 2 - MANIFEST (28px): the chips, where it lands, and the readings,
          right above the field they are about. */}
      <div className="relative z-[1] flex h-7 min-w-0 items-center gap-2 px-2" data-dock-row>
        <DockChips console={d} />
        <DockTarget console={d} />
        <DockReadout console={d} />
      </div>

      {/* 3 - COMMAND (58px): the objective and the launch, one row. */}
      <DockCommandRow console={d} />

      {/* 4 - META (20px): a fixed-height swap slot, never a mount. */}
      <DockMetaRow console={d} />
    </>
  );
}
