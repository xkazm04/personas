import { Filter, ChevronDown } from 'lucide-react';
// -- Dropdown wrapper ----------------------------------------------

interface FilterDropdownProps {
  label: string;
  icon?: React.ReactNode;
  activeCount: number;
  isOpen: boolean;
  onToggle: () => void;
  wide?: boolean;
  children: React.ReactNode;
}

export function FilterDropdown({
  label,
  icon,
  activeCount,
  isOpen,
  onToggle,
  wide,
  children,
}: FilterDropdownProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg border transition-colors ${
          activeCount > 0
            ? 'border-primary/25 bg-primary/8 text-primary'
            : 'border-primary/10 text-muted-foreground/70 hover:bg-secondary/40 hover:text-foreground/80'
        }`}
      >
        {icon ?? <Filter className="w-3 h-3" />}
        {label}
        {activeCount > 0 && (
          <span className="w-4 h-4 rounded-full bg-primary/20 text-primary text-[10px] flex items-center justify-center font-bold">
            {activeCount}
          </span>
        )}
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      {isOpen && (
          <div
            className={`animate-fade-slide-in absolute top-full left-0 mt-1 z-50 ${wide ? 'w-56' : 'w-44'} p-1.5 rounded-xl border border-primary/12 bg-background/95 backdrop-blur-md shadow-elevation-3 shadow-black/20`}
          >
            {children}
          </div>
        )}
    </div>
  );
}

// -- Filter option row ---------------------------------------------

interface FilterOptionProps {
  label: string;
  selected: boolean;
  color?: string;
  onToggle: () => void;
}

export function FilterOption({ label, selected, color, onToggle }: FilterOptionProps) {
  return (
    <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-secondary/30 cursor-pointer transition-colors">
      <input
        type="checkbox"
        checked={selected}
        onChange={onToggle}
        className="rounded border-primary/30 text-primary focus-visible:ring-primary/30 w-3.5 h-3.5"
      />
      {color && (
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
      )}
      <span className="text-sm text-foreground/80 truncate">{label}</span>
    </label>
  );
}
