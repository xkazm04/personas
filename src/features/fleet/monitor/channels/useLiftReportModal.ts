import { useEffect } from 'react';

/**
 * Lift the report modal above the Monitor overlay.
 *
 * THE BUG THIS EXISTS FOR: the Persona Monitor is mounted by `TrayOverlays`
 * *inside* `<div class="titlebar">`, and `globals.css` gives `.titlebar`
 * `position:relative; z-index:9999` — a stacking context far above everything
 * else. `ReportDetailModal` → `DetailModal` → `BaseModal portal`, which
 * portals to `document.body`; and because `DetailModal` passes an explicit
 * `containerClassName` (`fixed inset-0 z-[200] …`), `BaseModal` deliberately
 * skips its own `zIndex: Z_INDEX_PORTAL_BASE (10000)` style
 * (`BaseModal.tsx` — `style={containerClassName ? undefined : {...}}`).
 * So the modal mounted at z-200 while the opaque `bg-background` monitor sat
 * at 9999: the fetch ran, the modal rendered, and the user saw nothing.
 *
 * (The team channel's `ChannelDetailModal` works from the same surface only
 * because it uses a NON-portal `BaseModal`, which renders in-tree inside the
 * monitor's own stacking context.)
 *
 * The real fix is one token in the shared `DetailModal` (stop hard-coding
 * `z-[200]`, or let `BaseModal` merge its portal z with a supplied container
 * class) — out of this change's scope, and it would move every DetailModal in
 * the app. Until then this lifts OUR overlay only, and no-ops the moment the
 * shared fix lands (it never lowers a container that is already high enough).
 */
const MONITOR_TITLEBAR_Z = 9999;
const REPORT_MODAL_Z = 10050;

export function useLiftReportModal(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const lift = () => {
      // `detail-modal-title` is DetailModal's fixed titleId, so this reaches
      // exactly the overlay we opened and nothing else on <body>.
      const host = document.getElementById('detail-modal-title')?.closest('body > div');
      if (!(host instanceof HTMLElement)) return false;
      const current = Number.parseInt(window.getComputedStyle(host).zIndex, 10);
      if (!Number.isFinite(current) || current <= MONITOR_TITLEBAR_Z) {
        host.style.zIndex = String(REPORT_MODAL_Z);
      }
      return true;
    };
    // The modal is lazy, so it usually is not in the DOM on this first pass.
    if (lift()) return;
    const observer = new MutationObserver(() => {
      if (lift()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [open]);
}

