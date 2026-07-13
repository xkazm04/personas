// ---------------------------------------------------------------------------
// Error-action navigation dispatcher
//
// `ErrorExplanation.action` (errorExplanation.ts) carries a `navigate` target
// but no behaviour. Two surfaces execute it: the execution-detail
// `ErrorExplanationCard` (with a persona in context) and the global toast
// stack (no persona in context). This module centralises the target → store
// dispatch so both surfaces stay consistent.
//
// Stores are a lower layer than features, so a lib module may drive them
// directly via `getState()` (mirrors what `ErrorExplanationCard` does through
// hook selectors).
// ---------------------------------------------------------------------------

import { useSystemStore } from '@/stores/systemStore';
import { useAgentStore } from '@/stores/agentStore';
import type { ErrorAction } from './errorExplanation';

/**
 * Execute an {@link ErrorAction}'s navigation. `persona-settings` needs a
 * persona in context — callers without one (e.g. global toasts) should gate on
 * {@link isGlobalErrorAction} first; passing `null` here makes it a no-op.
 */
export function applyErrorAction(action: ErrorAction, personaId?: string | null): void {
  switch (action.navigate) {
    case 'vault':
      useSystemStore.getState().setSidebarSection('credentials');
      break;
    case 'triggers':
      useSystemStore.getState().setSidebarSection('events');
      break;
    case 'persona-settings':
      if (personaId) {
        useAgentStore.getState().selectPersona(personaId);
        useSystemStore.getState().setEditorTab('settings');
      }
      break;
  }
}

/**
 * Whether an action can be executed without a persona context — i.e. it is safe
 * to surface on a global toast. `persona-settings` requires a selected persona,
 * so it is excluded.
 */
export function isGlobalErrorAction(action: ErrorAction): boolean {
  return action.navigate === 'vault' || action.navigate === 'triggers';
}
