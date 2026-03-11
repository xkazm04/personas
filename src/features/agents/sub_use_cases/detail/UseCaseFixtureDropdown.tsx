import { useState, useCallback, useRef, useEffect } from 'react';
import { Database, Plus, Trash2, ChevronDown, Save, Pencil } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/features/shared/components/buttons';
import type { TestFixture } from '@/lib/types/frontendTypes';

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
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowAddForm(false);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const selectedFixture = fixtures.find((f) => f.id === selectedFixtureId);

  const handleSave = useCallback(() => {
    if (!newName.trim()) return;
    onSave(newName.trim(), newDescription.trim(), currentInputs ?? {});
    setNewName('');
    setNewDescription('');
    setShowAddForm(false);
  }, [newName, newDescription, currentInputs, onSave]);

  const handleDelete = useCallback(
    (id: string) => {
      onDelete(id);
      setConfirmDeleteId(null);
      if (selectedFixtureId === id) onSelect(null);
    },
    [onDelete, onSelect, selectedFixtureId],
  );

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        onClick={() => setIsOpen(!isOpen)}
        variant="ghost"
        size="sm"
        icon={<Database className="w-3.5 h-3.5" />}
        iconRight={<ChevronDown className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} />}
        className={`px-2.5 py-1.5 rounded-xl border ${
          selectedFixture
            ? 'bg-amber-500/10 border-amber-500/25 text-amber-300 hover:bg-amber-500/20'
            : 'bg-secondary/40 border-primary/10 text-muted-foreground/70 hover:border-primary/25'
        }`}
        title={selectedFixture ? `Fixture: ${selectedFixture.name}` : 'Select test fixture'}
      >
        <span className="truncate max-w-[120px]">
          {selectedFixture?.name ?? 'No fixture'}
        </span>
      </Button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-1 z-50 w-64 rounded-xl bg-popover border border-primary/15 shadow-xl shadow-black/30 overflow-hidden"
          >
            {/* No fixture option */}
            <Button
              onClick={() => {
                onSelect(null);
                setIsOpen(false);
              }}
              variant="ghost"
              size="sm"
              block
              className={`w-full px-3 py-2 rounded-none text-left ${
                !selectedFixtureId
                  ? 'bg-primary/10 text-foreground/90'
                  : 'text-muted-foreground/80 hover:bg-secondary/50'
              }`}
            >
              <span className="text-muted-foreground/50">--</span>
              No fixture (auto-generate)
            </Button>

            {/* Fixture list */}
            {fixtures.length > 0 && (
              <div className="border-t border-primary/10">
                {fixtures.map((f) => (
                  <div
                    key={f.id}
                    className={`group flex items-center justify-between px-3 py-2 text-sm transition-colors cursor-pointer ${
                      selectedFixtureId === f.id
                        ? 'bg-primary/10 text-foreground/90'
                        : 'text-muted-foreground/80 hover:bg-secondary/50'
                    }`}
                    onClick={() => {
                      onSelect(f.id);
                      setIsOpen(false);
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{f.name}</span>
                      {f.description && (
                        <span className="block truncate text-xs text-muted-foreground/50">
                          {f.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 ml-2">
                      {selectedFixtureId === f.id && currentInputs && (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            onUpdate(f.id, currentInputs);
                          }}
                          variant="ghost"
                          size="xs"
                          className="p-1 rounded text-muted-foreground/60 hover:text-primary"
                          title="Update fixture with current inputs"
                          icon={<Pencil className="w-3 h-3" />}
                        />
                      )}
                      {confirmDeleteId === f.id ? (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(f.id);
                          }}
                          variant="danger"
                          size="xs"
                          className="px-1.5 py-0.5 bg-red-500/15 hover:bg-red-500/25 text-red-400"
                        >
                          Confirm
                        </Button>
                      ) : (
                        <Button
                          onClick={(e) => {
                            e.stopPropagation();
                            setConfirmDeleteId(f.id);
                          }}
                          variant="ghost"
                          size="xs"
                          className="p-1 rounded hover:bg-red-500/15 text-muted-foreground/60 hover:text-red-400"
                          title="Delete fixture"
                          icon={<Trash2 className="w-3 h-3" />}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add fixture form */}
            <div className="border-t border-primary/10">
              {showAddForm ? (
                <div className="p-3 space-y-2">
                  <input
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="e.g. Happy Path"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-background/60 border border-primary/15 text-sm text-foreground/90 placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSave();
                      if (e.key === 'Escape') setShowAddForm(false);
                    }}
                  />
                  <input
                    type="text"
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Description (optional)"
                    className="w-full px-2.5 py-1.5 rounded-lg bg-background/60 border border-primary/15 text-sm text-foreground/90 placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/30"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={handleSave}
                      disabled={!newName.trim()}
                      variant="secondary"
                      size="xs"
                      icon={<Save className="w-3 h-3" />}
                      className="bg-primary/15 border-primary/20 text-primary hover:bg-primary/25"
                    >
                      Save
                    </Button>
                    <Button
                      onClick={() => setShowAddForm(false)}
                      variant="ghost"
                      size="xs"
                      className="text-muted-foreground/60 hover:text-foreground/80"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  onClick={() => setShowAddForm(true)}
                  variant="ghost"
                  size="sm"
                  block
                  icon={<Plus className="w-3.5 h-3.5" />}
                  className="w-full px-3 py-2 rounded-none text-muted-foreground/60 hover:text-primary/80 hover:bg-secondary/30"
                >
                  Save current as fixture
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
