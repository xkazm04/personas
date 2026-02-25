import type { PersonaDraft } from '@/features/agents/sub_editor/PersonaDraft';
import { ModelSelector } from '@/features/agents/sub_editor/model-config/ModelSelector';
import type { CustomModelConfig } from '@/features/agents/sub_editor/model-config/ModelSelector';
import type { ModelProvider } from '@/lib/types/frontendTypes';

interface DefaultModelSectionProps {
  draft: PersonaDraft;
  patch: (updates: Partial<PersonaDraft>) => void;
  modelDirty: boolean;
}

export function DefaultModelSection({ draft, patch, modelDirty }: DefaultModelSectionProps) {
  return (
    <div className="space-y-3">
      <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
        <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
        Persona Default Model
      </h4>
      <p className="text-sm text-muted-foreground/70 -mt-1 ml-[34px]">
        All use cases inherit this model unless overridden below.
      </p>
      <ModelSelector
        selectedModel={draft.selectedModel}
        onSelectModel={(value) => patch({ selectedModel: value })}
        customConfig={{
          selectedProvider: draft.selectedProvider,
          customModelName: draft.customModelName,
          baseUrl: draft.baseUrl,
          authToken: draft.authToken,
          onProviderChange: (p: ModelProvider) => patch({ selectedProvider: p }),
          onCustomModelNameChange: (n) => patch({ customModelName: n }),
          onBaseUrlChange: (u) => patch({ baseUrl: u }),
          onAuthTokenChange: (t) => patch({ authToken: t }),
        } satisfies CustomModelConfig}
        maxBudget={draft.maxBudget}
        maxTurns={draft.maxTurns}
        onMaxBudgetChange={(v) => patch({ maxBudget: v as number | '' })}
        onMaxTurnsChange={(v) => patch({ maxTurns: v as number | '' })}
        dirty={modelDirty}
        hideHeader
      />
    </div>
  );
}
