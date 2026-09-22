/**
 * Athena's master switch, for the surfaces that must DISAPPEAR when she is off.
 *
 * Reads the status store directly rather than `useCompanionsStatus`: Athena has
 * no prerequisite, so she never needs Curator's registry override, and the app
 * shell must not pull that chain into its bundle to learn one boolean.
 *
 * **`enabled` is optimistic while the answer is unknown**, and that is the
 * deliberate choice: the setting defaults to ON, so assuming OFF would make
 * every install blink her orb and footer icon into existence a moment after
 * launch. An install that has switched her off instead mounts her inert
 * overlays for the length of one IPC round-trip and then drops them.
 *
 * `settled` is for the callers that must not act on the optimistic answer -
 * anything that FIRES something (`companion_init`, a bridge subscription)
 * waits for a real read rather than starting work it may have to undo.
 */
import { useEffect } from "react";

import {
  attachCompanionsStatus,
  detachCompanionsStatus,
  useCompanionsStatusSlot,
} from "./companionsStatusStore";

export interface AthenaEnabledView {
  /** Whether Athena runs. Optimistically true until the first read settles. */
  enabled: boolean;
  /** True once a real answer has arrived at least once. */
  settled: boolean;
}

export function useAthenaEnabled(): AthenaEnabledView {
  const slot = useCompanionsStatusSlot();

  useEffect(() => {
    attachCompanionsStatus();
    return detachCompanionsStatus;
  }, []);

  const athena = slot.companions?.find((c) => c.id === "athena") ?? null;
  return { enabled: athena?.enabled ?? true, settled: athena !== null };
}
