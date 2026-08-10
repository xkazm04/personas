/**
 * Dispatch a `ClientAction` — the UI-side half of an approved Athena action.
 *
 * Two callers, deliberately sharing one implementation:
 *  - `ApprovalCard` runs it with the action returned by `companionApproveAction`
 *    when the operator clicks Approve.
 *  - `useAthenaChatNavigation` runs it on `COMPANION_CLIENT_ACTION_EVENT`, which
 *    the backend emits when an approval auto-fires under autonomous mode and
 *    there is no card (and so no return value) to carry the follow-up.
 *
 * Both paths must land on exactly the same screen state, so the dispatch lives
 * here rather than being re-derived in either place.
 */

import { openExternalUrl } from '@/api/system/system';
import type { ClientAction } from '@/api/companion';
import { toastCatch } from '@/lib/silentCatch';
import type { SidebarSection } from '@/lib/types/types';
import { useSystemStore } from '@/stores/systemStore';

const VALID_ROUTES: SidebarSection[] = [
  'home',
  'overview',
  'personas',
  'events',
  'credentials',
  'design-reviews',
  'plugins',
  'schedules',
  'settings',
];

const VALID_COMPANION_TABS = ['setup', 'memory', 'voice', 'decisions'] as const;

export function applyClientAction(action: ClientAction): void {
  if (action.type === 'navigate') {
    const route = action.route as SidebarSection;
    if (!VALID_ROUTES.includes(route)) return;
    useSystemStore.getState().setSidebarSection(route);
    return;
  }
  if (action.type === 'prefill_persona_create') {
    // Phase F: stash the prefill payload, then switch to the personas
    // section. UnifiedBuildEntry consumes the payload on mount (or on
    // next render if it's already mounted) and clears it.
    useSystemStore.getState().setCompanionPrefill({
      intent: action.intent,
      name: action.name,
      autoLaunch: action.autoLaunch,
      mode: action.mode === 'one_shot' ? 'one_shot' : 'interactive',
      companionSessionId: action.companionSessionId ?? null,
    });
    useSystemStore.getState().setSidebarSection('personas');
    return;
  }
  if (action.type === 'open_companion_tab') {
    // Phase F: deep-link into a specific tab inside the Companion
    // plugin. Three layers of state to set: top-level sidebar section
    // (`plugins`), which plugin is active (`companion`), and which
    // sub-tab inside the companion plugin. Order matters — sidebar
    // first so the route renders, then the tabs land before the
    // plugin page reads them on mount.
    if (!(VALID_COMPANION_TABS as readonly string[]).includes(action.tab)) {
      return;
    }
    const sys = useSystemStore.getState();
    sys.setSidebarSection('plugins');
    sys.setPluginTab('companion');
    sys.setCompanionPluginTab(action.tab as (typeof VALID_COMPANION_TABS)[number]);
    return;
  }
  if (action.type === 'open_external_url') {
    // Open a dev project's test-environment URL in the browser via the
    // validated open_external_url command (http/https only).
    openExternalUrl(action.url).catch(toastCatch('ApprovalCard:openTestEnv'));
    return;
  }
}
