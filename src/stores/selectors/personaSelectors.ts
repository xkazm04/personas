/**
 * Derived selectors for the selected persona's parsed design context.
 *
 * These eliminate the need for every component to independently call
 * `parseDesignContext(selectedPersona?.design_context)`.
 *
 * Reference stability is guaranteed by the LRU(1) cache inside
 * `parseDesignContext` — the same `design_context` string always
 * returns the exact same object, so zustand's default `Object.is`
 * equality check prevents unnecessary re-renders.
 */

import { useAgentStore } from '../agentStore';
import { parseDesignContext } from '@/features/shared/components/use-cases/UseCasesList';
import type { DesignContextData, DesignUseCase } from '@/lib/types/frontendTypes';

const EMPTY_USE_CASES: DesignUseCase[] = [];
const EMPTY_CRED_LINKS: Record<string, string> = {};

/** Full parsed design context for the currently selected persona. */
export function useParsedDesignContext(): DesignContextData {
  return useAgentStore((s) => parseDesignContext(s.selectedPersona?.design_context));
}

/** Use cases extracted from the selected persona's design context. */
export function useSelectedUseCases(): DesignUseCase[] {
  return useAgentStore((s) => parseDesignContext(s.selectedPersona?.design_context).useCases) ?? EMPTY_USE_CASES;
}

/** Credential links extracted from the selected persona's design context. */
export function useSelectedCredentialLinks(): Record<string, string> {
  return useAgentStore((s) => parseDesignContext(s.selectedPersona?.design_context).credentialLinks) ?? EMPTY_CRED_LINKS;
}
