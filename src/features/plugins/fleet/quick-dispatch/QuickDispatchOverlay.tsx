import { useQuickDispatchController } from './quickDispatchController';
import { QuickDispatchConsole } from './QuickDispatchConsole';

/**
 * Quick Dispatch overlay — the fastest path from "I want a session on X" to a
 * running fleet session, without leaving the current page.
 *
 * Summoned by nav-mode `C` (TitleBarDock) or the titlebar console capsule.
 * The behavior lives in {@link useQuickDispatchController}; the presentation
 * is the CONSOLE deck (winner of the 2026-08-25 /prototype round): a
 * bottom-docked command deck whose volatile panels (typeahead suggestions,
 * recent dispatches) render absolutely ABOVE it, out of document flow — the
 * structural cure for the height-shake the original top-anchored,
 * content-sized card exhibited.
 *
 * Mounting still follows the CommandPalette idiom: an unpainted
 * `fixed inset-0` container with the paint on a separate `absolute inset-0`
 * scrim child (which also keeps this outside the `hand-painted-modal-backdrop`
 * census rule), close on scrim click and on Escape inside the surface — no
 * global keyboard claim.
 */
export default function QuickDispatchOverlay() {
  const c = useQuickDispatchController();

  if (!c.open) return null;

  return (
    <div className="fixed inset-0 z-[9999]" data-testid="quick-dispatch-overlay">
      <div
        className="animate-fade-slide-in absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={c.closeQuickDispatch}
        aria-label={c.quickT.close}
      />
      <QuickDispatchConsole c={c} />
    </div>
  );
}
