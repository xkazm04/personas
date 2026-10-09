// The contract the dock's shell signs.
//
// The shell receives the console (one brain) and renders ONLY in-flow rows:
// the volatile panels are hosted once by `DockPanels` in the host, out of
// document flow, so the shell cannot put one in its own column by accident.
//
// Each row the shell renders carries `z-[1]` and a literal reserved height.
// That is not decoration — it is what the anti-shake test measures, and it is
// the reason the board above the dock cannot move while the operator types.
//
// Three shells signed this contract until 2026-10-06, behind a persisted
// switch; the operator kept `console` and the other two were deleted. The
// interface stays a named type rather than being inlined because it is the
// place that statement lives.

import type { DockConsole } from './useDockConsole';

export interface DockShellProps {
  console: DockConsole;
}
