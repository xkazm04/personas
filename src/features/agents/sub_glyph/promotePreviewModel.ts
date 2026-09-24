import type { PromotePreview } from "@/lib/bindings/PromotePreview";

/** One trigger promote will write, and when a time-based one first fires. */
export interface PromoteFireView {
  triggerType: string;
  description: string | null;
  /** RFC 3339, or null for a trigger woken by an event, a webhook or a person. */
  nextFireAt: string | null;
}

/** What the Glyph approval renders before the Promote click. */
export interface PromoteView {
  /** False only when promote would refuse; a missing preview never blocks. */
  canPromote: boolean;
  /** The refusal promote would raise, verbatim; null when it would not. */
  reason: string | null;
  /** Connectors that still need setup after promote (it stays needs_credentials). */
  needsSetup: string[];
  /** What the design-pass hygiene changed on the operator's behalf. */
  repairs: string[];
  fires: PromoteFireView[];
  /** False when there is nothing worth a panel. */
  hasContent: boolean;
}

const EMPTY: PromoteView = {
  canPromote: true,
  reason: null,
  needsSetup: [],
  repairs: [],
  fires: [],
  hasContent: false,
};

/**
 * Fold the backend `PromotePreview` into the view the approval renders.
 * `null` (still loading, or the preview itself failed) is deliberately the
 * permissive view: the preview is advisory, and promote runs its own checks.
 */
export function toPromoteView(preview: PromotePreview | null | undefined): PromoteView {
  if (!preview) return EMPTY;
  if (!preview.promotable) {
    return { ...EMPTY, canPromote: false, reason: preview.refusal ?? "", hasContent: true };
  }
  const needsSetup = (preview.setup?.blockers ?? []).map((b) => b.connector);
  const repairs = preview.setup?.notes ?? [];
  const fires = preview.nextFires.map((f) => ({
    triggerType: f.triggerType,
    description: f.description,
    nextFireAt: f.nextFireAt,
  }));
  return {
    canPromote: true,
    reason: null,
    needsSetup,
    repairs,
    fires,
    hasContent: needsSetup.length > 0 || repairs.length > 0 || fires.length > 0,
  };
}
