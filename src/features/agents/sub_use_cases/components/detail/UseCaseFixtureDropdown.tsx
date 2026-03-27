import { useState, useRef, useEffect } from 'react';
import { Database, ChevronDown } from 'lucide-react';
import type { TestFixture } from '@/lib/types/frontendTypes';
import { FixtureList, AddFixtureForm } from './FixtureDropdownList';

interface UseCaseFixtureDropdownProps {
  fixtures: TestFixture[];
  selectedFixtureId: string | null;
  onSelect: (fixtureId: string | null) => void;
  onSave: (name: string, description: string, inputs: Record<string, unknown>) => void;
  onDelete: (fixtureId: string) => void;
  onUpdate: (fixtureId: string, inputs: Record<string, unknown>) => void;
  currentInputs?: Record<string, unknown>;
}

export function UseCaseFixtureDropdown({
  fixtures,
  selectedFixtureId,
  onSelect,
  onSave,
  onDelete,
  onUpdate,
  currentInputs,
}: UseCaseFixtureDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const selectedFixture = fixtures.find((f) => f.id === selectedFixtureId);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-sm font-medium border transition-colors ${
          selectedFixture
            ? 'bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/20'
            : 'bg-secondary/40 border-primary/10 text-muted-foreground/70 hover:border-primary/30'
        }`}
        title={selectedFixture ? `Fixture: ${selectedFixture.name}` : 'Select test fixture'}
      >
        <Database className="w-3.5 h-3.5" />
        <span className="truncate max-w-[120px]">
          {selectedFixture?.name ?? 'No fixture'}
        </span>
        <ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
          <div
            className="animate-fade-slide-in absolute top-full left-0 mt-1 z-50 w-64 rounded-xl bg-popover border border-primary/20 shadow-elevation-3 shadow-black/30 overflow-hidden"
          >
            {/* No fixture option */}
            <button
              onClick={() => { onSelect(null); setIsOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm transition-colors ${
                !selectedFixtureId
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-muted-foreground/80 hover:bg-secondary/50'
              }`}
            >
              <span className="text-muted-foreground/50">--</span>
              No fixture (auto-generate)
            </button>

            <FixtureList
              fixtures={fixtures}
              selectedFixtureId={selectedFixtureId}
              currentInputs={currentInputs}
              onSelect={onSelect}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onClose={() => setIsOpen(false)}
            />

            <AddFixtureForm currentInputs={currentInputs} onSave={onSave} />
          </div>
        )}
    </div>
  );
}
