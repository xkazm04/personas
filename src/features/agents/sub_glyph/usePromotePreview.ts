import { useEffect, useRef, useState } from "react";

import { previewPromoteBuildDraft } from "@/api/agents/buildSession";
import { silentCatch } from "@/lib/silentCatch";
import { createLatestWins } from "@/stores/util/latestWins";
import type { PromotePreview } from "@/lib/bindings/PromotePreview";

export interface PromotePreviewArgs {
  sessionId: string | null;
  personaId: string | null;
  /** The build phase; only `test_complete` is a draft awaiting promote. */
  phase: string | null;
  /** Capability ids the operator removed; promote honours the same list. */
  excludedIds: readonly string[];
}

/**
 * Fetch the read-only promote preview while the draft waits at
 * `test_complete`, and again whenever the exclusion list changes. Returns
 * `null` while loading, outside `test_complete`, or when the preview itself
 * failed: the preview is advisory and must never stand between the operator
 * and Promote, so a failure is reported to telemetry, not to the screen.
 */
export function usePromotePreview({
  sessionId,
  personaId,
  phase,
  excludedIds,
}: PromotePreviewArgs): PromotePreview | null {
  const [preview, setPreview] = useState<PromotePreview | null>(null);
  // A slow answer for an older exclusion list must not overwrite a newer one.
  const latestWins = useRef(createLatestWins()).current;
  // A new array holding the same ids is not a new question.
  const excludedKey = excludedIds.join("\u0000");
  const active = phase === "test_complete" && !!sessionId && !!personaId;

  useEffect(() => {
    const token = latestWins.next();
    if (!active || !sessionId || !personaId) {
      setPreview(null);
      return;
    }
    const excluded = excludedKey ? excludedKey.split("\u0000") : [];
    previewPromoteBuildDraft(sessionId, personaId, excluded)
      .then((next) => {
        if (latestWins.isCurrent(token)) setPreview(next);
      })
      .catch((err: unknown) => {
        if (latestWins.isCurrent(token)) setPreview(null);
        silentCatch("usePromotePreview")(err);
      });
  }, [active, sessionId, personaId, excludedKey, latestWins]);

  return preview;
}
