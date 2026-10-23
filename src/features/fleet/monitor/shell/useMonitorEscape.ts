import { FULLSCREEN_LAYER_PRIORITY, useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';

/**
 * Escape on the Monitor: the innermost layer first (`back`, the drawers), and
 * only then the Monitor itself.
 *
 * ON THE APP'S KEYBOARD LADDER, NOT A BARE `window` LISTENER (2026-10-16).
 * The listener used to sit on `window` beside the ladder rather than on it, so
 * a surface above the Monitor that consumed Escape could not stop it reaching
 * here. The blueprint sheet showed it: at its site level Escape closes the
 * sheet (its exclusive rung, 88), the sheet unmounts before this listener ran,
 * the `[role="dialog"]` check below found nothing, and the same press closed
 * the Monitor too, so the operator landed on the app instead of back on the
 * Blueprint tab. On the ladder at the full-screen-layer rung (60), every
 * surface above it (BaseModal 80, the Decision Deck 85, the sheet 88) answers
 * first and a key it consumes never arrives. Outside a provider (tests)
 * `useAppKeyboard` falls back to a `window` listener, as before.
 *
 * A HIDDEN MONITOR DOES NOT ANSWER ESCAPE. Before persistence a closed Monitor
 * was an unmounted Monitor, so there was no listener to answer with. Keeping
 * it registered while hidden would be a behaviour change, not an
 * optimisation: one Escape pressed anywhere else in the app — dismissing a
 * sidebar popover, leaving a field — would tear down the whole Monitor, or
 * clear a drawer selection the operator left open on purpose and expects to
 * find again. Gating the REGISTRATION (`enabled`) rather than the body also
 * means a hidden Monitor costs the keyboard path nothing at all.
 */
export function useMonitorEscape({ visible, back, onClose }: {
  visible: boolean;
  /** Closes the innermost open layer; false when none was open. */
  back: () => boolean;
  onClose: () => void;
}): void {
  useAppKeyboard((e) => {
    if (e.key !== 'Escape') return false;
    // A MODAL ABOVE US OWNS ESCAPE FIRST, including one that is not on the
    // ladder. Every modal this surface can raise — the triage card, the
    // channel reply, a fleet terminal, the shared detail modals — portals to
    // `document.body`. Without this guard, one press both closed the card and
    // tore down the whole Monitor behind it: the reviewer dismissed a card and
    // lost the queue they were working. Checked against the live DOM rather
    // than tracked as state on purpose: the modals are owned by three
    // different children (and the shared ones by components this file does
    // not import), so a flag would have to be plumbed up from each of them and
    // would go stale the moment a fourth arrives. `[role="dialog"]` is what
    // BaseModal already stamps.
    if (document.querySelector('[role="dialog"]')) return false;
    if (!back()) onClose();
    return true;
  }, { enabled: visible, priority: FULLSCREEN_LAYER_PRIORITY });
}
