import { useSystemStore } from '@/stores/systemStore';
import { storeBus } from '@/lib/storeBus';
import type { SidebarSection } from '@/lib/types/types';
import type { GuidanceCtaAction, GuidancePreAction } from './types';

/**
 * The small set of app-driving side-effects guidance is allowed to perform —
 * shared by step `preAction`s (run before a step points at its anchor) and
 * walkthrough completion `cta`s (run when the user clicks "do it now"). Kept
 * here as named primitives so both call sites stay in sync and the full set of
 * things guidance can *do* to the app is auditable in one place.
 */

/** Open the persona build studio (the surface `persona_creation` rings). */
export function openBuildStudio() {
  // `isCreatingPersona` is what PersonasPage checks to render UnifiedBuildEntry
  // (vs the persona list / editor).
  const sys = useSystemStore.getState();
  sys.setSidebarSection('personas');
  sys.setIsCreatingPersona(true);
}

/**
 * Drive the Vault to its "Add new" view (the connector type picker). The
 * credential nav lives in a React context, not a global store; `storeBus` is its
 * from-outside-React escape hatch (the onboarding tour uses the same event).
 * Navigating to `credentials` first makes this safe to call from anywhere
 * (idempotent when the route is already mounted).
 */
export function openCredentialAddView() {
  useSystemStore.getState().setSidebarSection('credentials');
  storeBus.emit('tour:navigate-credential-view', { key: 'add-new' });
}

/** Navigate the sidebar to a section — the "Take me there" hand-off for a
 *  `point_at` that rings a nav item. The section comes from the anchor catalog
 *  (`dest`), so it stays bounded to the allow-listed set. */
export function navigateToSection(section: SidebarSection) {
  useSystemStore.getState().setSidebarSection(section);
}

/** Run a step's allow-listed pre-action (open a surface so its anchor mounts). */
export function runPreAction(action: GuidancePreAction) {
  switch (action) {
    case 'open_build_entry':
      openBuildStudio();
      break;
    case 'open_credential_add':
      openCredentialAddView();
      break;
  }
}

/** Run a walkthrough's completion CTA — the "do it now" hand-off into action. */
export function runGuidanceCta(action: GuidanceCtaAction) {
  switch (action) {
    case 'build_persona':
      openBuildStudio();
      break;
    case 'open_connector_add':
      openCredentialAddView();
      break;
  }
}
