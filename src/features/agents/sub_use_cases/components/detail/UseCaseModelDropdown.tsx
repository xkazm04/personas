import { Cpu, ChevronDown, Check, Link2 } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import type { UseCaseItem } from '@/features/shared/components/use-cases/UseCasesList';
import {
  MODEL_OPTIONS,
  OVERRIDE_OPTIONS,
  profileToOptionId,
  type ModelOption,
} from '../../libs/useCaseDetailHelpers';
import { useTranslation } from '@/i18n/useTranslation';

interface UseCaseModelDropdownProps {
  hasOverride: boolean;
  modelLabel: string;
  personaDefaultLabel: string;
  useCase: UseCaseItem;
  onSelectModel: (opt: ModelOption) => void;
}

export function UseCaseModelDropdown({
  hasOverride,
  modelLabel,
  personaDefaultLabel,
  useCase,
  onSelectModel,
}: UseCaseModelDropdownProps) {
  const { t } = useTranslation();
  const uc = t.agents.use_cases;
  return (
    <Listbox
      ariaLabel="Select model"
      itemCount={MODEL_OPTIONS.length}
      onSelectFocused={(index) => onSelectModel(MODEL_OPTIONS[index]!)}
      className="min-w-[180px]"
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-modal typo-body font-medium border transition-all w-full ${
            hasOverride
              ? 'bg-amber-500/8 border-amber-500/20 text-foreground/90'
              : 'bg-secondary/40 border-primary/10 text-foreground hover:border-primary/20'
          }`}
        >
          <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left truncate">{modelLabel}</span>
          {/* Provenance badge */}
          {hasOverride ? (
            <span className="typo-heading font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 flex-shrink-0">
              {uc.override}
            </span>
          ) : (
            <span className="typo-body font-medium px-1.5 py-0.5 rounded bg-secondary/50 text-foreground border border-primary/10 flex-shrink-0 flex items-center gap-0.5">
              <Link2 className="w-2.5 h-2.5" />
              {uc.inherited_label}
            </span>
          )}
          <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 max-h-56 overflow-y-auto">
          {/* Persona Default group */}
          <div className="px-3 pt-1.5 pb-1 typo-heading font-semibold uppercase tracking-wider text-foreground">
            {uc.persona_default}
          </div>
          <button
            role="option"
            aria-selected={!hasOverride}
            onClick={() => { onSelectModel(MODEL_OPTIONS[0]!); close(); }}
            className={`flex items-center gap-2 w-full px-3 py-2 typo-body transition-colors ${
              focusIndex === 0 ? 'bg-secondary/60' : 'hover:bg-secondary/40'
            } ${!hasOverride ? 'text-primary' : 'text-foreground'}`}
          >
            <Link2 className="w-3 h-3 flex-shrink-0 text-foreground" />
            <span className="flex-1 text-left">
              {uc.use_persona_default}
              <span className="text-foreground ml-1.5">({personaDefaultLabel})</span>
            </span>
            {!hasOverride && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
          </button>

          {/* Divider */}
          <div className="my-1 border-t border-primary/10" />

          {/* Override options group */}
          <div className="px-3 pt-1.5 pb-1 typo-heading font-semibold uppercase tracking-wider text-amber-400/50">
            {uc.override}
          </div>
          {OVERRIDE_OPTIONS.map((opt, i) => {
            const globalIndex = i + 1; // offset by 1 for the __default__ entry
            const isActive = hasOverride && profileToOptionId(useCase.model_override) === opt.id;
            return (
              <button
                key={opt.id}
                role="option"
                aria-selected={isActive}
                onClick={() => { onSelectModel(opt); close(); }}
                className={`flex items-center gap-2 w-full px-3 py-1.5 typo-body transition-colors ${
                  focusIndex === globalIndex ? 'bg-secondary/60' : 'hover:bg-secondary/40'
                } ${isActive ? 'text-amber-400' : 'text-foreground'}`}
              >
                <span className="flex-1 text-left">{opt.label}</span>
                {isActive && <Check className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </Listbox>
  );
}
