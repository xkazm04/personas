/**
 * Derived selectors for the selected persona's parsed design context.
 *
 * These eliminate the need for every component to independently call
 * `parseDesignContext(selectedPersona?.design_context)`.
 *
 * Reference stability: `parseDesignContext` memoizes results in a bounded
 * LRU keyed by the raw `design_context` string (and returns one shared frozen
 * object for the null/empty case). So the same raw string returns the exact
 * same parsed object reference while it remains in the cache, letting zustand's
 * default `Object.is` equality skip unnecessary re-renders. This guarantee is
 * bounded, not unconditional: if more distinct design_context strings than the
 * cache capacity are parsed between reads, the least-recently-used entry is
 * evicted and the next parse of that string yields a fresh reference.
 */

import { useAgentStore } from '../agentStore';
import { parseDesignContext } from '@/features/agents/sub_lab/use-cases/UseCasesList';
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
