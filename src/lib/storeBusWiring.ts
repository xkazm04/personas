/**
 * StoreBus Wiring — central registry of cross-store subscriptions and accessors.
 *
 * Call `initStoreBus()` once at app startup (alongside `initAllListeners`).
 * Every inter-store dependency that previously used `useXStore.getState()`
 * inside another domain's slice is declared here, making the full dependency
 * graph visible in a single file.
 */

import { storeBus, AccessorKey } from '@/lib/storeBus';
import { useAgentStore } from '@/stores/agentStore';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';
import { useAuthStore } from '@/stores/authStore';
import { useToastStore } from '@/stores/toastStore';
import { isNavRestoring } from '@/stores/slices/system/uiSlice';

let initialized = false;

/**
 * Last persona id observed by the nav-history capture. Lets the
 * `persona:selected` handler record the *outgoing* persona (the one we're
 * leaving) when the user switches agents — the event payload only carries the
 * incoming id. Module-scoped so it survives across emissions for the session.
 */
let lastNavPersonaId: string | null = null;

export function initStoreBus(): void {
  if (initialized) return;
  initialized = true;

  // -----------------------------------------------------------------------
  // Accessors — named, synchronous cross-domain data reads
  // -----------------------------------------------------------------------

  storeBus.provide(AccessorKey.AGENTS_PERSONAS, () => useAgentStore.getState().personas);

  storeBus.provide(AccessorKey.AGENTS_SELECTED_PERSONA_ID, () =>
    useAgentStore.getState().selectedPersona?.id,
  );

  storeBus.provide(AccessorKey.SYSTEM_CLOUD_CONFIG, () => useSystemStore.getState().cloudConfig);

  storeBus.provide(AccessorKey.VAULT_CREDENTIALS, () => useVaultStore.getState().credentials);

  storeBus.provide(AccessorKey.AUTH_IS_AUTHENTICATED, () => useAuthStore.getState().isAuthenticated);

  // -----------------------------------------------------------------------
  // Event subscriptions
  // -----------------------------------------------------------------------

  // Toast — toastStore reacts to toast events from any domain
  storeBus.on('toast', ({ message, type, duration }) => {
    useToastStore.getState().addToast(message, type, duration);
  });

  // Execution completed — systemStore emits tour event + activation milestone
  storeBus.on('execution:completed', () => {
    useSystemStore.getState().emitTourEvent('tour:execution-complete');
    void import('@/lib/analytics').then((a) => a.markActivation('execution_completed'));
  });

  // Persona selected — systemStore updates navigation chrome + records the
  // outgoing location for the back button (module-aware history). The event
  // payload is the INCOMING persona, so we push the location we're leaving
  // (current section + the previously-selected persona) before switching.
  // Skipped while a back-step is restoring, so "back" stays poppable.
  storeBus.on('persona:selected', ({ personaId }) => {
    const sys = useSystemStore.getState();
    if (!isNavRestoring() && personaId !== lastNavPersonaId) {
      sys.pushNavEntry({ section: sys.sidebarSection, personaId: lastNavPersonaId });
    }
    lastNavPersonaId = personaId;
    sys.setEditorTab('activity');
    if (personaId) useSystemStore.setState({ sidebarSection: 'personas' });
    useSystemStore.setState({ isCreatingPersona: false });
  });

  // Back-history restore — agentStore (re)selects the persona recorded in the
  // popped NavEntry. navigateBack sets isNavRestoring() first, so the
  // resulting persona:selected above won't push a new entry.
  storeBus.on('nav:select-persona', ({ personaId }) => {
    useAgentStore.getState().selectPersona(personaId);
  });

  // Network change (bundle import / share link import) — agentStore refreshes
  // personas; the receiving end of virality is an `imported` activation.
  storeBus.on('network:personas-changed', () => {
    void useAgentStore.getState().fetchPersonas();
    void import('@/lib/analytics').then((a) => a.markActivation('imported'));
  });

  // Trigger CRUD — agentStore refreshes persona detail
  storeBus.on('trigger:changed', ({ personaId }) => {
    void useAgentStore.getState().fetchDetail(personaId);
  });

  // Set persona home team — agentStore applies the operation
  storeBus.on('persona:set-home-team', ({ personaId, homeTeamId }) => {
    void useAgentStore.getState().applyPersonaOp(personaId, { kind: 'SetHomeTeam', home_team_id: homeTeamId });
  });

  // Appearance changed — systemStore emits tour event for appearance step completion
  storeBus.on('appearance:changed', () => {
    useSystemStore.getState().emitTourEvent('tour:appearance-changed');
  });

  // Build phase changed — systemStore advances tour sub-steps for persona creation.
  // The persona-creation step only completes on an actual PROMOTE (not the
  // earlier test_complete): the next tour step runs the live agent, which
  // requires it to be promoted. Promotion also records the created persona id
  // so the run step can open exactly that agent.
  storeBus.on('build:phase-changed', ({ phase }) => {
    const sys = useSystemStore.getState();
    if (!sys.tourActive) return;
    if (phase === 'draft_ready') sys.emitTourEvent('tour:persona-draft-ready');
    if (phase === 'promoted') {
      const pid = useAgentStore.getState().selectedPersona?.id;
      if (pid) sys.setTourCreatedPersona(pid);
      sys.emitTourEvent('tour:persona-promoted');
    }
  });
}
