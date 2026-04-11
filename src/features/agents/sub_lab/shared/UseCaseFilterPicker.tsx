import { useMemo } from 'react';
import { ChevronDown, Filter } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useSelectedUseCases } from '@/stores/selectors/personaSelectors';
import { useTranslation } from '@/i18n/useTranslation';

interface UseCaseFilterPickerProps {
  selectedUseCaseId: string | null;
  setSelectedUseCaseId: (id: string | null) => void;
  label?: string;
  testIdPrefix?: string;
}

export function UseCaseFilterPicker({ selectedUseCaseId, setSelectedUseCaseId, label = 'Focus', testIdPrefix }: UseCaseFilterPickerProps) {
  const { t } = useTranslation();
  const useCases = useSelectedUseCases();
  const useCaseOptions = useMemo(() => [{ value: '__all__', label: t.agents.lab.all_use_cases }, ...useCases.map((uc) => ({ value: uc.id, label: uc.title }))], [useCases]);

  if (useCases.length === 0) return null;

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground/80 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" />{label}</label>
      <Listbox itemCount={useCaseOptions.length} onSelectFocused={(idx) => { const opt = useCaseOptions[idx]; if (opt) setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); }} ariaLabel="Filter by use case"
        renderTrigger={({ isOpen, toggle }) => (
          <button onClick={toggle} data-testid={testIdPrefix ? `${testIdPrefix}-usecase-trigger` : undefined}
            className={`w-full flex items-center justify-between px-3 py-2 rounded-xl text-sm border transition-all ${isOpen ? 'bg-primary/10 border-primary/30 text-foreground/90' : 'bg-background/30 border-primary/10 text-muted-foreground/90 hover:border-primary/20'} cursor-pointer`}>
            <span>{useCaseOptions.find((o) => o.value === (selectedUseCaseId ?? '__all__'))?.label ?? t.agents.lab.all_use_cases}</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        )}>
        {({ close, focusIndex }) => (
          <div className="py-1 bg-background border border-primary/20 rounded-lg shadow-elevation-3 mt-1 max-h-48 overflow-y-auto">
            {useCaseOptions.map((opt, i) => (
              <button key={opt.value} onClick={() => { setSelectedUseCaseId(opt.value === '__all__' ? null : opt.value); close(); }}
                className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${focusIndex === i ? 'bg-primary/15 text-foreground' : ''} ${(selectedUseCaseId ?? '__all__') === opt.value ? 'text-primary font-medium' : 'text-muted-foreground/90 hover:bg-secondary/30'}`}>
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </Listbox>
    </div>
  );
}
