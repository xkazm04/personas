import { Cpu, ChevronDown, Check, Link2 } from 'lucide-react';
import { Listbox } from '@/features/shared/components/Listbox';
import type { UseCaseItem } from '@/features/shared/components/UseCasesList';
import {
  MODEL_OPTIONS,
  OVERRIDE_OPTIONS,
  profileToOptionId,
  type ModelOption,
} from './useCaseDetailHelpers';

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
          className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium border transition-all w-full ${
            hasOverride
              ? 'bg-amber-500/8 border-amber-500/20 text-foreground/90'
              : 'bg-secondary/40 border-primary/10 text-muted-foreground/80 hover:border-primary/20'
          }`}
        >
          <Cpu className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="flex-1 text-left truncate">{modelLabel}</span>
          {/* Provenance badge */}
          {hasOverride ? (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 flex-shrink-0">
              Override
            </span>
          ) : (
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-secondary/50 text-muted-foreground/60 border border-primary/8 flex-shrink-0 flex items-center gap-0.5">
              <Link2 className="w-2.5 h-2.5" />
              Inherited
            </span>
          )}
          <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 max-h-56 overflow-y-auto">
          {/* Persona Default group */}
          <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
            Persona Default
          </div>
          <button
            role="option"
            aria-selected={!hasOverride}
            onClick={() => { onSelectModel(MODEL_OPTIONS[0]!); close(); }}
            className={`flex items-center gap-2 w-full px-3 py-2 text-sm transition-colors ${
              focusIndex === 0 ? 'bg-secondary/60' : 'hover:bg-secondary/40'
            } ${!hasOverride ? 'text-primary' : 'text-foreground/80'}`}
          >
            <Link2 className="w-3 h-3 flex-shrink-0 text-muted-foreground/50" />
            <span className="flex-1 text-left">
              Use persona default
              <span className="text-muted-foreground/50 ml-1.5">({personaDefaultLabel})</span>
            </span>
            {!hasOverride && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
          </button>

          {/* Divider */}
          <div className="my-1 border-t border-primary/8" />

          {/* Override options group */}
          <div className="px-3 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/50">
            Override
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
                className={`flex items-center gap-2 w-full px-3 py-1.5 text-sm transition-colors ${
                  focusIndex === globalIndex ? 'bg-secondary/60' : 'hover:bg-secondary/40'
                } ${isActive ? 'text-amber-400' : 'text-foreground/80'}`}
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
