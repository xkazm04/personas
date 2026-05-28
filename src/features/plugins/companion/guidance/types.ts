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
}

export interface GuidanceWalkthrough {
  topic: string;
  title: (t: Translations) => string;
  steps: GuidanceStep[];
}
