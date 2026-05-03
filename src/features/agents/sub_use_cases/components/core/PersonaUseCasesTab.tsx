import { RecipesVariantSigilGrid } from '../recipes-prototype/RecipesVariantSigilGrid';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata } from '@/lib/types/types';

interface PersonaUseCasesTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
}

/**
 * Persona editor → Use Cases tab. Single rendering path: SigilGrid is the
 * canonical capability surface. The legacy `Grid` and `Glyph` baselines
 * (and the prototype tab switcher that toggled between them) were removed
 * in round 3i once SigilGrid reached functional parity + the Recipe
 * catalog filled in the adoption side of the loop.
 */
export function PersonaUseCasesTab(props: PersonaUseCasesTabProps) {
  return <RecipesVariantSigilGrid {...props} />;
}
