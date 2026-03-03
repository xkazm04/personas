import { useState, useCallback } from 'react';
import { Plus, Trash2, Star, ChevronDown, ChevronRight } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';

interface TablesTabProps {
  credentialId: string;
}

export function TablesTab({ credentialId }: TablesTabProps) {
  const tables = usePersonaStore((s) => s.dbSchemaTables).filter((t) => t.credential_id === credentialId);
  const createTable = usePersonaStore((s) => s.createDbSchemaTable);
  const updateTable = usePersonaStore((s) => s.updateDbSchemaTable);
  const deleteTable = usePersonaStore((s) => s.deleteDbSchemaTable);

  const [newTableName, setNewTableName] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState<{ id: string; value: string } | null>(null);

  const handleAdd = useCallback(async () => {
    const name = newTableName.trim();
    if (!name) return;
    await createTable(credentialId, name);
    setNewTableName('');
  }, [credentialId, newTableName, createTable]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAdd();
  };

  const handleToggleFavorite = useCallback(
    (id: string, current: boolean) => {
      updateTable(id, { isFavorite: !current });
    },
    [updateTable],
  );

  const handleLabelSave = useCallback(
    (id: string) => {
      if (!editingLabel || editingLabel.id !== id) return;
      updateTable(id, { displayLabel: editingLabel.value });
      setEditingLabel(null);
    },
    [editingLabel, updateTable],
  );

  return (
    <div className="p-6 space-y-4">
      {/* Add table input */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newTableName}
          onChange={(e) => setNewTableName(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Table name (e.g. users, orders)"
          className="flex-1 px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-sm text-foreground/90 placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/30 transition-colors"
        />
        <button
          onClick={handleAdd}
          disabled={!newTableName.trim()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          Add
        </button>
      </div>

      {/* Table list */}
      {tables.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-sm text-muted-foreground/50">
            No tables defined yet. Add tables you want to focus on.
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {tables.map((table) => {
            const isExpanded = expandedId === table.id;
            const isEditingLabel = editingLabel?.id === table.id;

            return (
              <div
                key={table.id}
                className="rounded-lg border border-primary/10 bg-secondary/15 overflow-hidden"
              >
                {/* Row */}
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : table.id)}
                    className="p-0.5 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <span className="text-sm font-mono text-foreground/80 flex-1 min-w-0 truncate">
                    {table.table_name}
                  </span>

                  {/* Display label */}
                  {isEditingLabel ? (
                    <input
                      autoFocus
                      value={editingLabel!.value}
                      onChange={(e) => setEditingLabel({ id: table.id, value: e.target.value })}
                      onBlur={() => handleLabelSave(table.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleLabelSave(table.id); }}
                      className="px-2 py-0.5 text-xs rounded border border-primary/20 bg-secondary/40 text-foreground/70 focus:outline-none focus:border-primary/40 w-32"
                    />
                  ) : (
                    <button
                      onClick={() =>
                        setEditingLabel({ id: table.id, value: table.display_label || '' })
                      }
                      className="text-xs text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                    >
                      {table.display_label || 'add label'}
                    </button>
                  )}

                  <button
                    onClick={() => handleToggleFavorite(table.id, table.is_favorite)}
                    className={`p-1 transition-colors ${
                      table.is_favorite
                        ? 'text-amber-400'
                        : 'text-muted-foreground/25 hover:text-amber-400/60'
                    }`}
                  >
                    <Star className="w-3.5 h-3.5" fill={table.is_favorite ? 'currentColor' : 'none'} />
                  </button>

                  <button
                    onClick={() => deleteTable(table.id)}
                    className="p-1 text-muted-foreground/25 hover:text-red-400/70 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Expanded: column hints */}
                {isExpanded && (
                  <div className="px-4 pb-3 pt-1 border-t border-primary/5">
                    <p className="text-xs text-muted-foreground/40 mb-2">
                      Column hints (JSON)
                    </p>
                    <textarea
                      value={table.column_hints || '[]'}
                      onChange={(e) =>
                        updateTable(table.id, { columnHints: e.target.value })
                      }
                      rows={4}
                      className="w-full px-3 py-2 rounded-lg bg-secondary/30 border border-primary/10 text-xs font-mono text-foreground/70 placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/30 resize-none transition-colors"
                      placeholder='[{"name": "id", "type": "uuid", "pk": true}, {"name": "email", "type": "text"}]'
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
