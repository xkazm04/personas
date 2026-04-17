import { useState, useRef } from 'react';
import { ArrowUpDown, ChevronDown } from 'lucide-react';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import { useViewportClampAbsolute } from '@/hooks/utility/interaction/useViewportClamp';
import { SORT_OPTIONS } from './searchConstants';

export function SortDropdown({
  sortBy,
  sortDir,
  onSortChange,
}: {
  sortBy: string;
  sortDir: string;
  onSortChange: (sortBy: string, sortDir: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useClickOutside(dropdownRef, isOpen, () => setIsOpen(false));
  const clampStyle = useViewportClampAbsolute(popupRef, isOpen);

  const defaultOption = { value: 'created_at', label: 'Newest First', dir: 'desc' };
  const currentOption = SORT_OPTIONS.find(
    (o) => {
      const optSort = o.value.replace(/_(?:asc|desc)$/, '');
      return optSort === sortBy && o.dir === sortDir;
    },
  ) ?? defaultOption;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="px-3 py-2 text-sm rounded-modal border border-primary/15 hover:bg-secondary/50 text-foreground transition-colors flex items-center gap-1.5"
      >
        <ArrowUpDown className="w-3.5 h-3.5" />
        {currentOption.label}
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div ref={popupRef} style={{ transform: clampStyle.transform }} className="absolute top-full right-0 mt-1 z-20 bg-background border border-primary/20 rounded-modal shadow-elevation-3 min-w-[190px] py-1.5 overflow-hidden">
          {SORT_OPTIONS.map((option) => {
            const optSort = option.value.replace(/_(?:asc|desc)$/, '');
            const isSelected = optSort === sortBy && option.dir === sortDir;
            return (
              <button
                key={option.value}
                onClick={() => {
                  onSortChange(optSort, option.dir);
                  setIsOpen(false);
                }}
                className={`w-full px-3.5 py-2.5 text-left text-sm transition-colors ${
                  isSelected
                    ? 'text-violet-300 bg-violet-500/10'
                    : 'text-foreground hover:bg-primary/5'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
