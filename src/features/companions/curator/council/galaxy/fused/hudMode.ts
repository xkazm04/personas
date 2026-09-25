// The instrument: three modes of one HUD, switched from the keyboard.
//
// `lens` is the bezel (the porthole dial round the field), `bar` the wide
// bottom cross-section, `none` the galaxy alone. The timeline, the decisions
// and Fit / Lens / Find are wayfinding and stay in every mode.
//
// The choice persists under `council-hud-mode`. With no stored choice, a
// stage below 1600 x 900 opens on the bar and one at or above opens on the
// lens, and resizing keeps following that default until the reader picks a
// mode themself (the winner's round-3 rule 6).
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

export type HudMode = 'lens' | 'bar' | 'none';

export const HUD_MODES: readonly HudMode[] = ['lens', 'bar', 'none'];

const MODE_KEY = 'council-hud-mode';

/** The monitor that earns the lens (and the spread dock) by default. */
export function isWideStage(width: number, height: number): boolean {
  return width >= 1600 && height >= 900;
}

export function defaultMode(width: number, height: number): HudMode {
  return isWideStage(width, height) ? 'lens' : 'bar';
}

/** The stored choice, or null when the reader never picked one. */
export function readStoredMode(): HudMode | null {
  const raw = safeLocalGet(MODE_KEY, 'council:hud-mode');
  return (HUD_MODES as readonly string[]).includes(raw ?? '') ? (raw as HudMode) : null;
}

export function storeMode(mode: HudMode): void {
  safeLocalSet(MODE_KEY, mode, 'council:hud-mode');
}

/** `M` moves forward through lens, bar, none; `Shift+M` moves back. */
export function cycleMode(mode: HudMode, step: 1 | -1): HudMode {
  const i = HUD_MODES.indexOf(mode);
  return HUD_MODES[(i + step + HUD_MODES.length) % HUD_MODES.length] ?? 'bar';
}
