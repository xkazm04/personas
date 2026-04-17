import { Check } from 'lucide-react';

export { PLATFORM_COLORS } from '../colorTokens';

export function SelectionCheckbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      className={`w-4 h-4 rounded-card flex items-center justify-center flex-shrink-0 transition-all duration-200 cursor-pointer ${
        checked
          ? 'bg-violet-500 border border-violet-500'
          : 'bg-secondary/40 border border-primary/20 hover:border-primary/40'
      }`}
    >
      {checked && (
          <div className="animate-fade-slide-in"
          >
            <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
          </div>
        )}
    </button>
  );
}
