// The Activity surface's lazy seams, in one place.
//
// WHY: `FleetGridView` was the ONLY heavy child of the Monitor still statically
// imported, and it alone carried 212 files / 30,255 lines — 38% of the
// Monitor's whole eager closure — onto a surface that is also the default
// landing view, so opening the Monitor on ANY view paid for it.
//
// WHAT STAYS STATIC: the shell. Command bar, workspace tabs, the supply
// column's chrome, the frames the panels land in. The Activity frame must
// paint complete in its first commit, with no hole in it.
//
// WHAT IS LAZY: the three weights, each mounted by the beat it belongs to —
// the board panel (tiles), the desk (rail) and the usage plates (usage) — plus
// the three surfaces nothing shows until the operator asks for them.
//
// NO VISIBLE SUSPENSE: each slot is preloaded on the shell's first commit
// (`preloadActivityPanels`), so by the time its beat admits it the module is
// already resolved and Suspense never suspends. The fallback is the SAME ghost
// the slot renders before its beat, so even if a slow disk makes it appear, it
// is indistinguishable from the frame that was already on screen and nothing
// reflows.

import { lazyRetry } from '@/lib/lazyRetry';
import { silentCatch } from '@/lib/silentCatch';

const importClassicPanel = () => import('./ClassicPanel').then((m) => ({ default: m.ClassicPanel }));
const importLanesPanel = () => import('./LanesPanel').then((m) => ({ default: m.LanesPanel }));
const importDeskSlot = () => import('./DeskSlot').then((m) => ({ default: m.DeskSlot }));
const importUsageSlot = () => import('./UsageSlot').then((m) => ({ default: m.UsageSlot }));
const importSessionModals = () => import('../../board/SessionModals').then((m) => ({ default: m.SessionModals }));
const importOrchestration = () => import('../../orchestration/OrchestrationPanel').then((m) => ({ default: m.OrchestrationPanel }));
const importQuickChat = () => import('./QuickChatComposer').then((m) => ({ default: m.QuickChatComposer }));

export const LazyClassicPanel = lazyRetry(importClassicPanel);
export const LazyLanesPanel = lazyRetry(importLanesPanel);
export const LazyDeskSlot = lazyRetry(importDeskSlot);
export const LazyUsageSlot = lazyRetry(importUsageSlot);
export const LazySessionModals = lazyRetry(importSessionModals);
export const LazyOrchestrationPanel = lazyRetry(importOrchestration);
export const LazyQuickChatComposer = lazyRetry(importQuickChat);

let preloaded = false;

/**
 * Start fetching every choreographed panel as soon as the shell has painted.
 * Idempotent and fire-and-forget: the authoritative report of a chunk that
 * cannot load is the lazy boundary's (`lazyRetry` retries once and then
 * surfaces to the ErrorBoundary when the slot actually mounts). A failed
 * PREFETCH is only a lost head start, so it is breadcrumbed, not raised.
 */
export function preloadActivityPanels(): void {
  if (preloaded) return;
  preloaded = true;
  for (const load of [importClassicPanel, importLanesPanel, importDeskSlot, importUsageSlot]) {
    void load().catch(silentCatch('fleet/activity:preload'));
  }
}

/** Test hatch — the preload-once flag is module state. */
export function _resetActivityPreloadForTests(): void {
  preloaded = false;
}
