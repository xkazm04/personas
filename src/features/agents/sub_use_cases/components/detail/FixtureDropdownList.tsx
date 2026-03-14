import { useState } from 'react';
import { Plus, Trash2, Save, Pencil } from 'lucide-react';
import type { TestFixture } from '@/lib/types/frontendTypes';

interface FixtureListProps {
  fixtures: TestFixture[];
  selectedFixtureId: string | null;
  currentInputs?: Record<string, unknown>;
  onSelect: (fixtureId: string | null) => void;
  onUpdate: (fixtureId: string, inputs: Record<string, unknown>) => void;
  onDelete: (fixtureId: string) => void;
  onClose: () => void;
}

export function FixtureList({ fixtures, selectedFixtureId, currentInputs, onSelect, onUpdate, onDelete, onClose }: FixtureListProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    onDelete(id);
    setConfirmDeleteId(null);
    if (selectedFixtureId === id) onSelect(null);
  };

  if (fixtures.length === 0) return null;

  return (
    <div className="border-t border-primary/10">
      {fixtures.map((f) => (
        <div
          key={f.id}
          className={`group flex items-center justify-between px-3 py-2 text-sm transition-colors cursor-pointer ${
            selectedFixtureId === f.id
              ? 'bg-primary/10 text-foreground/90'
              : 'text-muted-foreground/80 hover:bg-secondary/50'
          }`}
          onClick={() => { onSelect(f.id); onClose(); }}
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
              <button
                onClick={(e) => { e.stopPropagation(); onUpdate(f.id, currentInputs); }}
                className="p-1 rounded hover:bg-primary/15 text-muted-foreground/60 hover:text-primary transition-colors"
                title="Update fixture with current inputs"
              >
                <Pencil className="w-3 h-3" />
              </button>
            )}
            {confirmDeleteId === f.id ? (
              <button
                onClick={(e) => { e.stopPropagation(); handleDelete(f.id); }}
                className="px-1.5 py-0.5 text-xs font-medium text-red-400 bg-red-500/15 rounded hover:bg-red-500/25 transition-colors"
              >
                Confirm
              </button>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(f.id); }}
                className="p-1 rounded hover:bg-red-500/15 text-muted-foreground/60 hover:text-red-400 transition-colors"
                title="Delete fixture"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

interface AddFixtureFormProps {
  currentInputs?: Record<string, unknown>;
  onSave: (name: string, description: string, inputs: Record<string, unknown>) => void;
}

export function AddFixtureForm({ currentInputs, onSave }: AddFixtureFormProps) {
  const [showForm, setShowForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const handleSave = () => {
    if (!newName.trim()) return;
    onSave(newName.trim(), newDescription.trim(), currentInputs ?? {});
    setNewName('');
    setNewDescription('');
    setShowForm(false);
  };

  return (
    <div className="border-t border-primary/10">
      {showForm ? (
        <div className="p-3 space-y-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="e.g. Happy Path"
            className="w-full px-2.5 py-1.5 rounded-lg bg-background/60 border border-primary/20 text-sm text-foreground/90 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-primary/30"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave();
              if (e.key === 'Escape') setShowForm(false);
            }}
          />
          <input
            type="text"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            placeholder="Description (optional)"
            className="w-full px-2.5 py-1.5 rounded-lg bg-background/60 border border-primary/20 text-sm text-foreground/90 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-primary/30"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSave}
              disabled={!newName.trim()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-primary/15 border border-primary/20 text-primary hover:bg-primary/25 disabled:opacity-40 transition-colors"
            >
              <Save className="w-3 h-3" /> Save
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-2.5 py-1 text-xs text-muted-foreground/60 hover:text-foreground/80 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowForm(true)}
          className="w-full flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground/60 hover:text-primary/80 hover:bg-secondary/30 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Save current as fixture
        </button>
      )}
    </div>
  );
}
