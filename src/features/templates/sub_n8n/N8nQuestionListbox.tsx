import { ChevronDown, Check } from 'lucide-react';
import { Listbox } from '@/features/shared/components/Listbox';

interface N8nQuestionListboxProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  /** Tailwind classes applied to the trigger when a value is selected (e.g. tone.selectBg) */
  selectedClassName?: string;
}

export function N8nQuestionListbox({ options, value, onChange, selectedClassName }: N8nQuestionListboxProps) {
  return (
    <Listbox
      ariaLabel="Select an option"
      itemCount={options.length}
      onSelectFocused={(index) => {
        onChange(options[index]!);
      }}
      renderTrigger={({ isOpen, toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className={[
            'w-full flex items-center justify-between px-3 py-2.5 text-sm rounded-xl border transition-all',
            value && selectedClassName
              ? selectedClassName
              : 'border-primary/15 bg-background/50 text-foreground/80',
            isOpen ? 'ring-2 ring-primary/30 border-primary/30' : '',
          ].join(' ')}
        >
          <span className={value ? '' : 'text-muted-foreground/50'}>
            {value || 'Select\u2026'}
          </span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      )}
    >
      {({ close, focusIndex }) => (
        <div className="py-1 max-h-48 overflow-y-auto">
          {options.map((opt, idx) => {
            const isSelected = value === opt;
            const isFocused = focusIndex === idx;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => { onChange(opt); close(); }}
                className={[
                  'w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors',
                  isFocused ? 'bg-primary/10' : isSelected ? 'bg-primary/5' : 'hover:bg-secondary/40',
                  isSelected ? 'text-foreground font-medium' : 'text-foreground/80',
                ].join(' ')}
              >
                {isSelected
                  ? <Check className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                  : <span className="w-3.5 flex-shrink-0" />}
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </Listbox>
  );
}
