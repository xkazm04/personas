import { ChevronDown, Cpu, Link2, Check } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useAgentStore } from '@/stores/agentStore';
import { mutateSingleUseCase } from '@/hooks/design/core/useDesignContextMutator';
import { toastCatch } from '@/lib/silentCatch';
import { useTranslation } from '@/i18n/useTranslation';
import {
  MODEL_OPTIONS, OVERRIDE_OPTIONS,
  profileToOptionId, resolveEffectiveModel,
  type ModelOption,
} from '../../../libs/useCaseDetailHelpers';
import type { ModelProfile, ModelProvider } from '@/lib/types/frontendTypes';
import type { DisplayUseCase } from './displayUseCase';

interface TileModelStripProps {
  personaId: string;
  uc: DisplayUseCase;
  /** Persona's default model profile (raw JSON string from selectedPersona).
   *  Used to render the inherited label when the use case has no override. */
  personaDefaultModelProfile: string | null | undefined;
}

/**
 * Inline model selector for the SigilGrid tile's top row. Renders a
 * compact button (label + chevron) that fits between the status dot
 * (left) and power button (right) in a single justify-between row. Click
 * opens a grouped dropdown identical in semantics to `UseCaseModelDropdown`:
 *   - "Persona Default" — clears any per-use-case override
 *   - "Override" — Anthropic / Ollama presets
 *
 * Persists via `mutateSingleUseCase` then refreshes the persona detail.
 *
 * Design intent: the model is one of the most important per-use-case knobs
 * (cost + capability), but it shouldn't compete with the sigil for visual
 * weight. The trigger is muted by default; the override state is signalled
 * by a subtle amber tint so glancing at the grid reveals which capabilities
 * have been individually tuned.
 */
export function TileModelStrip({ personaId, uc, personaDefaultModelProfile }: TileModelStripProps) {
  const fetchDetail = useAgentStore((s) => s.fetchDetail);
  const { t, tx } = useTranslation();
  const hasOverride = !!uc.raw.model_override;
  const resolved = resolveEffectiveModel(uc.raw.model_override, personaDefaultModelProfile ?? null);
  const personaDefault = resolveEffectiveModel(undefined, personaDefaultModelProfile ?? null);

  const handleSelect = async (opt: ModelOption) => {
    try {
      await mutateSingleUseCase(personaId, uc.id, (existing) => {
        if (opt.id === '__default__') {
          const { model_override: _omit, ...rest } = existing;
          return { ...rest } as typeof existing;
        }
        const profile: ModelProfile = {
          model: opt.model,
          provider: opt.provider as ModelProvider,
          base_url: opt.base_url,
        };
        return { ...existing, model_override: profile };
      });
      await fetchDetail(personaId);
    } catch (err) {
      toastCatch('TileModelStrip:select')(err);
    }
  };

  return (
    <Listbox
      ariaLabel={t.agents.use_cases.model_select_aria}
      itemCount={MODEL_OPTIONS.length}
      onSelectFocused={(index) => {
        const opt = MODEL_OPTIONS[index];
        if (opt) void handleSelect(opt);
      }}
      className="flex-1 min-w-0"
      // Tiles live inside scrollable grid rows — the menu can otherwise land
      // over neighbouring tiles. Use a fully-opaque background and the highest
      // z-index in the editor surface so the dropdown wins every collision.
      menuClassName="animate-fade-slide-in absolute top-full mt-1 left-0 right-0 bg-card-bg border border-card-border rounded-xl shadow-elevation-4 z-[100] overflow-hidden"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          aria-expanded={isOpen}
          title={hasOverride
            ? tx(t.agents.use_cases.model_override_tooltip, { label: resolved.label })
            : tx(t.agents.use_cases.model_inherit_tooltip, { label: personaDefault.label })}
          className={`w-full flex items-center justify-center gap-1 px-2 py-0.5 rounded-interactive border transition-colors cursor-pointer ${
            hasOverride
              ? 'bg-status-warning/10 border-status-warning/30 text-status-warning/95 hover:bg-status-warning/18'
              : 'bg-secondary/40 border-card-border/60 text-foreground/70 hover:bg-secondary/60 hover:text-foreground/95 hover:border-foreground/30'
          }`}
        >
          <Cpu className="w-3 h-3 shrink-0" />
          <span className="typo-caption font-medium truncate min-w-0">
            {hasOverride ? resolved.label : personaDefault.label}
          </span>
          {!hasOverride && <Link2 className="w-2.5 h-2.5 shrink-0 opacity-70" />}
          <ChevronDown className={`w-3 h-3 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 max-h-56 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
          {/* Persona Default group */}
          <div className="px-3 pt-1.5 pb-1 typo-label uppercase tracking-wider text-foreground/55">
            {t.agents.use_cases.model_persona_default_group}
          </div>
          <button
            role="option"
            aria-selected={!hasOverride}
            onClick={(e) => { e.stopPropagation(); void handleSelect(MODEL_OPTIONS[0]!); close(); }}
            className={`flex items-center gap-2 w-full px-3 py-2 typo-body transition-colors cursor-pointer ${
              focusIndex === 0 ? 'bg-secondary/60' : 'hover:bg-secondary/40'
            } ${!hasOverride ? 'text-primary' : 'text-foreground'}`}
          >
            <Link2 className="w-3 h-3 flex-shrink-0 text-foreground/70" />
            <span className="flex-1 text-left">
              {t.agents.use_cases.model_use_persona_default}
              <span className="text-foreground/55 ml-1.5">({personaDefault.label})</span>
            </span>
            {!hasOverride && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
          </button>

          <div className="my-1 border-t border-card-border/60" />

          <div className="px-3 pt-1.5 pb-1 typo-label uppercase tracking-wider text-status-warning/70">
            {t.agents.use_cases.model_override_group}
          </div>
          {OVERRIDE_OPTIONS.map((opt, i) => {
            const globalIndex = i + 1;
            const isActive = hasOverride && profileToOptionId(uc.raw.model_override) === opt.id;
            return (
              <button
                key={opt.id}
                role="option"
                aria-selected={isActive}
                onClick={(e) => { e.stopPropagation(); void handleSelect(opt); close(); }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 typo-body transition-colors cursor-pointer ${
                  focusIndex === globalIndex ? 'bg-secondary/60' : 'hover:bg-secondary/40'
                } ${isActive ? 'text-status-warning' : 'text-foreground'}`}
              >
                <span className="flex-1 text-left">{opt.label}</span>
                {isActive && <Check className="w-3.5 h-3.5 text-status-warning flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </Listbox>
  );
}
