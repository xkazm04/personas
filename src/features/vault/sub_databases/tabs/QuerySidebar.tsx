import { useState, useCallback } from 'react';
import { Plus, Trash2, Star, Check, X } from 'lucide-react';
import { useVaultStore } from "@/stores/vaultStore";

interface QuerySidebarProps {
  credentialId: string;
  language: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function QuerySidebar({ credentialId, language, selectedId, onSelect }: QuerySidebarProps) {
  const queries = useVaultStore((s) => s.dbSavedQueries).filter((q) => q.credential_id === credentialId);
  const createQuery = useVaultStore((s) => s.createDbSavedQuery);
  const updateQuery = useVaultStore((s) => s.updateDbSavedQuery);
  const deleteQuery = useVaultStore((s) => s.deleteDbSavedQuery);

  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    const q = await createQuery(credentialId, title, '', language);
    if (q) {
      onSelect(q.id);
      setIsCreating(false);
      setNewTitle('');
    }
  }, [credentialId, newTitle, language, createQuery, onSelect]);

  const handleToggleFavorite = useCallback(
    (id: string, current: boolean) => {
      updateQuery(id, { isFavorite: !current });
    },
    [updateQuery],
  );

  return (
    <div className="w-64 border-r border-primary/10 flex flex-col shrink-0 bg-secondary/5">
      <div className="p-3 border-b border-primary/8">
        {isCreating ? (
            <div
              key="create-input"
              className="animate-fade-slide-in flex items-center gap-1"
            >
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsCreating(false); }}
                placeholder="Query title"
                className="flex-1 px-2.5 py-1.5 rounded-xl text-sm bg-background/50 border border-primary/15 text-foreground/80 focus-ring placeholder:text-muted-foreground/30"
              />
              <button onClick={handleCreate} className="p-1.5 rounded-lg text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 transition-colors">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setIsCreating(false)} className="p-1.5 rounded-lg text-muted-foreground/40 hover:text-muted-foreground/60 hover:bg-secondary/40 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              key="create-btn"
              onClick={() => setIsCreating(true)}
              className="animate-fade-slide-in w-full flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-sm font-medium text-primary/80 hover:bg-primary/8 border border-dashed border-primary/15 hover:border-primary/25 transition-all"
            >
              <Plus className="w-3.5 h-3.5" />
              New Query
            </button>
          )}
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {queries.map((q) => (
          <div
            key={q.id}
            className={`group flex items-center gap-1.5 px-2.5 py-2 rounded-xl cursor-pointer transition-all duration-150 ${
              selectedId === q.id
                ? 'bg-primary/10 border border-primary/20 shadow-sm shadow-primary/5'
                : 'hover:bg-secondary/40 border border-transparent'
            }`}
            onClick={() => onSelect(q.id)}
          >
            <span className="flex-1 text-sm text-foreground/70 truncate">{q.title}</span>

            {q.last_run_ok !== null && (
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${q.last_run_ok ? 'bg-emerald-400' : 'bg-red-400'}`} />
            )}

            <button
              onClick={(e) => { e.stopPropagation(); handleToggleFavorite(q.id, q.is_favorite); }}
              className={`p-0.5 transition-colors ${q.is_favorite ? 'text-amber-400' : 'text-muted-foreground/20 hover:text-amber-400/50'}`}
            >
              <Star className="w-3 h-3" fill={q.is_favorite ? 'currentColor' : 'none'} />
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); deleteQuery(q.id); if (selectedId === q.id) onSelect(''); }}
              className="p-0.5 text-muted-foreground/20 opacity-0 group-hover:opacity-100 hover:text-red-400/60 transition-all"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}

        {queries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2">
            <div className="w-10 h-10 rounded-xl bg-secondary/30 border border-primary/10 flex items-center justify-center">
              <Plus className="w-4 h-4 text-muted-foreground/50" />
            </div>
            <p className="text-sm text-muted-foreground/60">No saved queries</p>
          </div>
        )}
      </div>
    </div>
  );
}
