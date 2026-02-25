import { parseDesignContext, type UseCaseItem, type DesignContextData } from '@/features/shared/components/UseCasesList';

/** Find a single use case by ID from raw design_context JSON. */
export function getUseCaseById(
  rawDesignContext: string | null | undefined,
  useCaseId: string,
): UseCaseItem | undefined {
  const data = parseDesignContext(rawDesignContext);
  return data.use_cases?.find((uc) => uc.id === useCaseId);
}

/** Get all use cases from raw design_context JSON. */
export function getUseCases(rawDesignContext: string | null | undefined): UseCaseItem[] {
  return parseDesignContext(rawDesignContext).use_cases ?? [];
}

/**
 * Apply an updater function to a specific use case inside design_context,
 * returning the re-serialized JSON string.
 */
export function updateUseCaseInContext(
  rawDesignContext: string | null | undefined,
  useCaseId: string,
  updater: (uc: UseCaseItem) => UseCaseItem,
): string {
  const data: DesignContextData = parseDesignContext(rawDesignContext);
  const useCases = data.use_cases ?? [];
  const updated = useCases.map((uc) => (uc.id === useCaseId ? updater(uc) : uc));
  return JSON.stringify({ ...data, use_cases: updated });
}
