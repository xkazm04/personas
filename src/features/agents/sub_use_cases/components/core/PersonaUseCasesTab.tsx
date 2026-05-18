import { PersonaLayoutView } from '../persona-layout';
import type { PersonaDraft } from '@/features/agents/sub_editor';
import type { CredentialMetadata } from '@/lib/types/types';

interface PersonaUseCasesTabProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
  credentials: CredentialMetadata[];
}

/**
 * Persona editor → Use Cases tab. Renders the Persona Layout view —
 * Persona Sigil hero with left summary + right capability sidebars.
 *
 * History: this tab previously hosted a layout switcher between
 * `sigil-grid` (RecipesVariantSigilGrid) and `persona-layout`. The
 * switcher and the legacy sigil-grid variant were retired 2026-05-17
 * once the Persona Layout view had reached feature parity and the
 * full-width treatment landed — the switcher row and the prose-width
 * cap that gated the older grid both went away in the same pass.
 *
 * `draft`, `patch`, and `modelDirty` are kept on the prop interface so
 * the call site in DesignHub doesn't have to fork; the current
 * PersonaLayoutView only needs `credentials`, but the rest are stable
 * shape contracts for future affordances (model picker, dirty-state
 * indicators) that may want to live here without another prop break.
 */
export function PersonaUseCasesTab(props: PersonaUseCasesTabProps) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 min-h-0">
        <PersonaLayoutView credentials={props.credentials} />
      </div>
    </div>
  );
}
