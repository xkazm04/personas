// The contract every dock variant shell signs.
//
// A shell receives the console (one brain, three arrangements) and the variant
// switch, and renders ONLY in-flow rows: the volatile panels are hosted once by
// `DockPanels` in the host, out of document flow, so no shell can put one in
// its own column by accident.
//
// Each row a shell renders carries `z-[1]` and a literal reserved height. That
// is not decoration — it is what the anti-shake test measures, and it is the
// reason the board above the dock cannot move while the operator types.

import type { DockVariant } from '../dockVariant';
import type { DockConsole } from './useDockConsole';

export interface DockShellProps {
  console: DockConsole;
  variant: DockVariant;
  onVariantChange: (v: DockVariant) => void;
}
