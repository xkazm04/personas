import { parseDesignContext, serializeDesignContext } from '@/features/shared/components/UseCasesList';
import type { DesignContextData, DesignUseCase } from '@/lib/types/frontendTypes';

// Re-export UseCaseItem alias for backward compat
export type { DesignUseCase as UseCaseItem } from '@/lib/types/frontendTypes';

/** Find a single use case by ID from raw design_context JSON. */
export function getUseCaseById(
  rawDesignContext: string | null | undefined,
  useCaseId: string,
): DesignUseCase | undefined {
  const data = parseDesignContext(rawDesignContext);
  return data.useCases?.find((uc) => uc.id === useCaseId);
}

/** Get all use cases from raw design_context JSON. */
export function getUseCases(rawDesignContext: string | null | undefined): DesignUseCase[] {
  return parseDesignContext(rawDesignContext).useCases ?? [];
}

/**
 * Apply an updater function to a specific use case inside design_context,
 * returning the re-serialized JSON string.
 */
export function updateUseCaseInContext(
  rawDesignContext: string | null | undefined,
  useCaseId: string,
  updater: (uc: DesignUseCase) => DesignUseCase,
): string {
  const data: DesignContextData = parseDesignContext(rawDesignContext);
  const useCases = data.useCases ?? [];
  const updated = useCases.map((uc) => (uc.id === useCaseId ? updater(uc) : uc));
  return serializeDesignContext({ ...data, useCases: updated });
}
