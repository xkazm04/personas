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
import { navigateToCompanions } from '@/features/companions/navigation';
import type { CompanionsPage } from '@/features/companions/types';
import type { SidebarSection } from '@/lib/types/types';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';

const VALID_ROUTES: SidebarSection[] = [
  'home',
  'overview',
  'personas',
  'events',
  'credentials',
  'design-reviews',
  'plugins',
  'companions',
  'schedules',
  'settings',
];

const VALID_ATHENA_TABS = ['create-athena', 'setup', 'memory', 'voice', 'decisions'] as const;

/**
 * The backend still spells this action `open_companion_tab` and can still emit
 * `tab: "dashboard"` — a tab retired before the Companions move, which used to
 * be dropped on the floor. Setup is the surface that inherited its job, so the
 * dead value is REMAPPED here rather than silently doing nothing.
 */
const RETIRED_ATHENA_TABS: Readonly<Record<string, (typeof VALID_ATHENA_TABS)[number]>> = { dashboard: 'setup' };

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
    useSystemStore.getState().setAthenaPrefill({
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
    // Deep-link onto one of Athena's pages. The wire name is unchanged (the
    // backend still says `open_companion_tab`), but there is only ONE piece of
    // state to set now: the Companions destination. `navigateToCompanions`
    // moves the section and the page together.
    const tab = (VALID_ATHENA_TABS as readonly string[]).includes(action.tab)
      ? action.tab
      : RETIRED_ATHENA_TABS[action.tab];
    if (!tab) return;
    navigateToCompanions(`athena:${tab}` as CompanionsPage);
    return;
  }
  if (action.type === 'open_external_url') {
    // Open a dev project's test-environment URL in the browser via the
    // validated open_external_url command (http/https only).
    openExternalUrl(action.url).catch(toastCatch('ApprovalCard:openTestEnv'));
    return;
  }
  if (action.type === 'reconnect_credential') {
    // A revoked OAuth grant can only be re-consented by the operator, in their
    // own browser. Two flags, deliberately both: `focusCredentialId` opens the
    // right credential, `autoReconnectCredentialId` says the operator ALREADY
    // consented (they approved the action / answered the orb), so the vault
    // starts the re-auth rather than showing one more button. Both are consumed
    // once and cleared by the vault.
    const vault = useVaultStore.getState();
    vault.setFocusCredentialId(action.credentialId);
    vault.setAutoReconnectCredentialId(action.credentialId);
    useSystemStore.getState().setSidebarSection('credentials');
    return;
  }
}
