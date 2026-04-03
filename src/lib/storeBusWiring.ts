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

let initialized = false;

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

  // Execution completed — systemStore emits tour event
  storeBus.on('execution:completed', () => {
    useSystemStore.getState().emitTourEvent('tour:execution-complete');
  });

  // Persona selected — systemStore updates navigation chrome
  storeBus.on('persona:selected', ({ personaId }) => {
    useSystemStore.getState().setEditorTab('activity');
    if (personaId) useSystemStore.setState({ sidebarSection: 'personas' });
    useSystemStore.setState({ isCreatingPersona: false, resumeDraftId: null });
  });

  // Network change (bundle import / share link import) — agentStore refreshes personas
  storeBus.on('network:personas-changed', () => {
    void useAgentStore.getState().fetchPersonas();
  });

  // Trigger CRUD — agentStore refreshes persona detail
  storeBus.on('trigger:changed', ({ personaId }) => {
    void useAgentStore.getState().fetchDetail(personaId);
  });

  // Move persona to group — agentStore applies the operation
  storeBus.on('persona:move-to-group', ({ personaId, groupId }) => {
    void useAgentStore.getState().applyPersonaOp(personaId, { kind: 'MoveToGroup', group_id: groupId ?? '' });
  });

  // Appearance changed — systemStore emits tour event for appearance step completion
  storeBus.on('appearance:changed', () => {
    useSystemStore.getState().emitTourEvent('tour:appearance-changed');
  });

  // Build phase changed — systemStore advances tour sub-steps for persona creation
  storeBus.on('build:phase-changed', ({ phase }) => {
    const sys = useSystemStore.getState();
    if (!sys.tourActive) return;
    if (phase === 'draft_ready') sys.emitTourEvent('tour:persona-draft-ready');
    if (phase === 'test_complete' || phase === 'promoted') sys.emitTourEvent('tour:persona-promoted');
  });
}
