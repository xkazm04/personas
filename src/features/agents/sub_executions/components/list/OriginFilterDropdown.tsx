import { ChevronDown, Check, Route } from 'lucide-react';
import { Listbox } from '@/features/shared/components/forms/Listbox';
import { useTranslation } from '@/i18n/useTranslation';
import { EXECUTION_ORIGINS, type ExecutionOrigin } from '../../libs/executionOrigin';
import { ORIGIN_META, originLabel } from './OriginBadge';
import Button from '@/features/shared/components/buttons/Button';
import { OptionRow } from '@/features/shared/components/forms/OptionRow';

interface OriginFilterDropdownProps {
  value: ExecutionOrigin | null;
  onChange: (value: ExecutionOrigin | null) => void;
}

/**
 * Origin filter for the execution list: All origins / Attention / Channel /
 * Scheduled / Manual / Simulation. Single-select; picking the active option
 * again clears back to All.
 */
export function OriginFilterDropdown({ value, onChange }: OriginFilterDropdownProps) {
  const { t } = useTranslation();
  const e = t.agents.executions;
  const options: (ExecutionOrigin | null)[] = [null, ...EXECUTION_ORIGINS];

  return (
    <Listbox
      ariaLabel={e.origin_filter_label}
      itemCount={options.length}
      onSelectFocused={(i) => {
        const next = options[i] ?? null;
        onChange(next === value ? null : next);
      }}
      renderTrigger={({ isOpen, toggle }) => (
        <Button
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          variant={value !== null ? 'secondary' : 'ghost'}
          size="xs"
          icon={<Route className="w-3 h-3" />}
        >
          {value === null ? e.origin_filter_all : originLabel(t, value)}
          <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </Button>
      )}
    >
      {({ close }) => (
        <div className="py-1 min-w-[10rem]">
          {options.map((option) => {
            const active = option === value;
            const Icon = option === null ? Route : ORIGIN_META[option].icon;
            return (
              <OptionRow
                key={option ?? 'all'}
                role="option"
                selected={active}
                onSelect={() => {
                  onChange(active ? null : option);
                  close();
                }}
              >
                <Icon className="w-3.5 h-3.5" />
                <span className="flex-1 text-left">
                  {option === null ? e.origin_filter_all : originLabel(t, option)}
                </span>
                {active && <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />}
              </OptionRow>
            );
          })}
        </div>
      )}
    </Listbox>
  );
}
