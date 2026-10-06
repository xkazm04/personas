/**
 * useLiftDetailModal — lift a shared `DetailModal` above the Monitor overlay.
 *
 * The incident and report modals are built on `DetailModal`, which portals to
 * `<body>` with a hard-coded `z-[200]` container; the Monitor is mounted inside
 * the title bar's stacking context at z-index 9999. So the modal renders, under
 * an opaque Monitor, and the person sees nothing. The diagnosis and the first
 * copy of this fix are `useLiftReportModal` in
 * `fleet/monitor/channels/PersonaConversation.tsx`; this is the same lift for
 * the hub's two DetailModal surfaces.
 *
 * DUPLICATE ON PURPOSE, AND TEMPORARY: the real fix is one token in the shared
 * `DetailModal` (out of this package's scope). Both copies no-op the moment it
 * lands — neither ever lowers a container that is already high enough.
 */
import { useEffect } from 'react';

const MONITOR_TITLEBAR_Z = 9999;
const DETAIL_MODAL_Z = 10050;

export function useLiftDetailModal(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const lift = () => {
      // `detail-modal-title` is DetailModal's fixed title id.
      const host = document.getElementById('detail-modal-title')?.closest('body > div');
      if (!(host instanceof HTMLElement)) return false;
      const current = Number.parseInt(window.getComputedStyle(host).zIndex, 10);
      if (!Number.isFinite(current) || current <= MONITOR_TITLEBAR_Z) {
        host.style.zIndex = String(DETAIL_MODAL_Z);
      }
      return true;
    };
    if (lift()) return;
    const observer = new MutationObserver(() => {
      if (lift()) observer.disconnect();
    });
    observer.observe(document.body, { childList: true });
    return () => observer.disconnect();
  }, [open]);
}
