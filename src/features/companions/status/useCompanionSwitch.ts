/**
 * One companion's enable switch, for the three Setup pages.
 *
 * The rule the three pages share, and the reason this is a hook rather than
 * three copies: **locked is not broken, and OFF is never refused.** A
 * companion whose prerequisite is missing cannot be switched ON, so the
 * control is disabled and states the prerequisite on itself; but an operator
 * must always be able to switch one OFF, whatever state it is in.
 *
 * The backend emits `companions://status-changed` on a successful write, so
 * the happy path needs no read-back - the switch moves because the status did.
 * Only a refusal re-reads, to resync a control that did not move.
 */
import { useCallback, useMemo, useState } from "react";

import { companionsSetEnabled } from "@/api/companions";
import { useTranslation } from "@/i18n/useTranslation";
import { toastCatch } from "@/lib/silentCatch";

import type { CompanionId, CompanionStatusDto } from "../types";
import { useCompanionsStatus } from "./useCompanionsStatus";

export interface CompanionSwitch {
  /** This companion's standing, or null while the first read is in flight. */
  status: CompanionStatusDto | null;
  /** True until the first read settles. */
  loading: boolean;
  /** True while a write is in flight. */
  busy: boolean;
  /** True when the control must not be operated: no status yet, mid-write, or off with an unmet prerequisite. */
  locked: boolean;
  /** What is missing, stated ON the control while it is locked; null when nothing is. */
  prerequisite: string | null;
  /** Flip it. Resolves when the write settles; a refusal is toasted, not thrown. */
  toggle: () => Promise<void>;
}

export function useCompanionSwitch(id: CompanionId): CompanionSwitch {
  const { t, tx } = useTranslation();
  const { byId, loading, refresh } = useCompanionsStatus();
  const [busy, setBusy] = useState(false);
  const status = byId(id);

  const prerequisite = useMemo(() => {
    if (!status || status.eligible) return null;
    if (id === "overseer") return t.companions.setup.overseer_prerequisite;
    if (id === "curator") return t.companions.setup.curator_prerequisite;
    return t.companions.blocker.not_onboarded;
  }, [status, id, t]);

  const toggle = useCallback(async () => {
    if (!status || busy) return;
    const next = !status.enabled;
    setBusy(true);
    try {
      await companionsSetEnabled(id, next);
    } catch (err) {
      // The refusal is decided by WHICH prerequisite is missing, which this
      // side already knows - so the message is chosen from the status rather
      // than read out of the error text.
      const name = t.companions.nav[`group_${id}` as const];
      const message =
        !status.eligible && id === "overseer"
          ? t.companions.errors.overseer_needs_star
          : !status.eligible && id === "curator"
            ? t.companions.errors.curator_needs_registry
            : tx(t.companions.errors.toggle_failed, { name });
      toastCatch(`companions_set_enabled:${id}`, message)(err);
      // The control did not move; re-read so it stops showing an intent the
      // backend refused.
      refresh();
    } finally {
      setBusy(false);
    }
  }, [status, busy, id, t, tx, refresh]);

  return {
    status,
    loading,
    busy,
    locked: busy || !status || (!status.enabled && !status.eligible),
    prerequisite,
    toggle,
  };
}
