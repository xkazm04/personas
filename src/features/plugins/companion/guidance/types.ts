import type { SidebarSection } from '@/lib/types/types';
import type { Translations } from '@/i18n/useTranslation';

/**
 * Where the orb parks relative to the highlighted element. `auto` picks the
 * side with the most room (right → left → below → above); `center` floats the
 * orb mid-screen (used for intro/outro steps that have no element to point at).
 */
export type OrbAnchor = 'auto' | 'left' | 'right' | 'above' | 'below' | 'center';

/**
 * A small, allow-listed app side-effect a step can perform before it points at
 * its anchor — e.g. open a surface so the anchor exists to highlight. Kept as a
 * closed enum (not arbitrary callbacks) so walkthroughs stay declarative data
 * and the set of things a guided step can *do* is auditable.
 */
export type GuidancePreAction = 'open_build_entry' | 'open_credential_add';

/**
 * Allow-listed action a walkthrough's completion CTA can run — the "do it now"
 * that closes the show→do loop after Athena finishes guiding. Same closed-enum
 * discipline as `GuidancePreAction` (auditable, not arbitrary callbacks); both
 * resolve through `guidance/appActions.ts`.
 */
export type GuidanceCtaAction = 'build_persona' | 'open_connector_add';

/**
 * Primary button shown on a walkthrough's last step to hand the user off into
 * action; clicking runs it and stops the walkthrough. Two shapes:
 *  - `action` — an allow-listed closed-enum effect. Used by the **registry**
 *    walkthroughs so authored data stays declarative + auditable.
 *  - `onSelect` — a closure. Used only by **runtime-built** ad-hoc walkthroughs
 *    (`point_at`/`compose`), where the builder constructs the handler in code
 *    (e.g. navigate to the anchor's `dest`) rather than authoring static data.
 */
export type GuidanceCta = { label: (t: Translations) => string } & (
  | { action: GuidanceCtaAction; onSelect?: never }
  | { onSelect: () => void; action?: never }
);

export interface GuidanceStep {
  /** Stable id (for keys + test assertions). */
  id: string;
  /** Caption text shown beside the orb (and spoken when voice is configured). */
  narration: (t: Translations) => string;
  /** Element to ring with the non-dimming glow this step. Omit for a pure narration beat. */
  highlightTestId?: string;
  /** Where the orb parks relative to the highlight (default `auto`). */
  orbAnchor?: OrbAnchor;
  /** Switch the sidebar route before this step runs. */
  navigateRoute?: SidebarSection;
  /** Run an allow-listed app action before pointing (e.g. open the build studio). */
  preAction?: GuidancePreAction;
  /** Override the auto-advance dwell (ms). Default derives from narration length. */
  dwellMs?: number;
  /**
   * Wait for the user to actually click the highlighted element before
   * advancing — a "your turn" beat, not a timed slide. Suppresses the
   * auto-advance dwell (Skip/Stop still work). Requires `highlightTestId`; with
   * none set it falls back to the timer so a walkthrough can never hard-stall.
   * Independent of the universal click-to-advance (clicking the highlight always
   * advances) — this just removes the timer so the step *only* moves on a click.
   */
  holdForClick?: boolean;
}

export interface GuidanceWalkthrough {
  topic: string;
  title: (t: Translations) => string;
  steps: GuidanceStep[];
  /**
   * Optional completion CTA, shown as a primary button on the **last** step —
   * the "now do it" hand-off after the tour (e.g. "Start building" /
   * "Open the catalog"). Ad-hoc walkthroughs (`point_at` / `compose`) omit it.
   */
  cta?: GuidanceCta;
}
