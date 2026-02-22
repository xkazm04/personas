import { usePersonaStore } from '@/stores/personaStore';
import { UseCasesList } from '@/features/shared/components/UseCasesList';

export function PersonaUseCasesTab() {
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);

  if (!selectedPersona) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground/80">
        No persona selected
      </div>
    );
  }

  return (
    <UseCasesList
      designContext={selectedPersona.design_context}
      emptyMessage="No use cases defined for this persona."
      emptyHint="Import from an n8n workflow or use the Design Wizard to generate use cases."
    />
  );
}
