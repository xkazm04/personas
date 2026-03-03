import { useState, useCallback } from 'react';
import { Plus, Trash2, Star, Play, Check, X } from 'lucide-react';
import { usePersonaStore } from '@/stores/personaStore';
import { SqlEditor } from '../SqlEditor';
import { QueryResultTable } from '../QueryResultTable';
import type { QueryResult } from '@/api/dbSchema';

interface QueriesTabProps {
  credentialId: string;
  language: string;
}

export function QueriesTab({ credentialId, language }: QueriesTabProps) {
  const queries = usePersonaStore((s) => s.dbSavedQueries).filter((q) => q.credential_id === credentialId);
  const createQuery = usePersonaStore((s) => s.createDbSavedQuery);
  const updateQuery = usePersonaStore((s) => s.updateDbSavedQuery);
  const deleteQuery = usePersonaStore((s) => s.deleteDbSavedQuery);
  const executeDbQuery = usePersonaStore((s) => s.executeDbQuery);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editorValue, setEditorValue] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [executing, setExecuting] = useState(false);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedQuery = queries.find((q) => q.id === selectedId);

  const handleSelect = useCallback((id: string) => {
    const q = queries.find((q) => q.id === id);
    if (q) {
      setSelectedId(id);
      setEditorValue(q.query_text);
      setResult(null);
      setError(null);
    }
  }, [queries]);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    if (!title) return;
    const q = await createQuery(credentialId, title, '', language);
    if (q) {
      setSelectedId(q.id);
      setEditorValue('');
      setIsCreating(false);
      setNewTitle('');
    }
  }, [credentialId, newTitle, language, createQuery]);

  const handleSave = useCallback(async () => {
    if (!selectedId) return;
    await updateQuery(selectedId, { queryText: editorValue });
  }, [selectedId, editorValue, updateQuery]);

  const handleExecute = useCallback(async () => {
    if (!editorValue.trim()) return;
    setExecuting(true);
    setError(null);
    setResult(null);
    try {
      const res = await executeDbQuery(credentialId, editorValue);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExecuting(false);
    }
  }, [credentialId, editorValue, executeDbQuery]);

  const handleToggleFavorite = useCallback(
    (id: string, current: boolean) => {
      updateQuery(id, { isFavorite: !current });
    },
    [updateQuery],
  );

  return (
    <div className="flex h-full min-h-[500px]">
      {/* Sidebar: query list */}
      <div className="w-64 border-r border-primary/10 flex flex-col shrink-0">
        <div className="p-3 border-b border-primary/5">
          {isCreating ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsCreating(false); }}
                placeholder="Query title"
                className="flex-1 px-2 py-1 rounded text-xs bg-secondary/30 border border-primary/15 text-foreground/80 focus:outline-none focus:border-primary/30"
              />
              <button onClick={handleCreate} className="p-1 text-emerald-400 hover:text-emerald-300">
                <Check className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setIsCreating(false)} className="p-1 text-muted-foreground/40 hover:text-muted-foreground/60">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsCreating(true)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-400/80 hover:bg-blue-500/10 transition-colors"
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
              className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
                selectedId === q.id
                  ? 'bg-primary/10 border border-primary/20'
                  : 'hover:bg-secondary/40 border border-transparent'
              }`}
              onClick={() => handleSelect(q.id)}
            >
              <span className="flex-1 text-xs text-foreground/70 truncate">{q.title}</span>

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
                onClick={(e) => { e.stopPropagation(); deleteQuery(q.id); if (selectedId === q.id) setSelectedId(null); }}
                className="p-0.5 text-muted-foreground/20 hover:text-red-400/60 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}

          {queries.length === 0 && (
            <p className="text-xs text-muted-foreground/40 text-center py-8">
              No saved queries
            </p>
          )}
        </div>
      </div>

      {/* Editor + results */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedQuery ? (
          <>
            {/* Editor toolbar */}
            <div className="flex items-center gap-2 px-4 py-2 border-b border-primary/5 shrink-0">
              <span className="text-xs font-medium text-foreground/60 flex-1">{selectedQuery.title}</span>
              <span className="text-xs text-muted-foreground/30 px-2 py-0.5 rounded bg-secondary/40">{language}</span>
              <button
                onClick={handleSave}
                className="px-2.5 py-1 rounded-lg text-xs font-medium text-muted-foreground/60 hover:text-foreground/70 hover:bg-secondary/40 transition-colors"
              >
                Save
              </button>
              <button
                onClick={handleExecute}
                disabled={executing || !editorValue.trim()}
                className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <Play className="w-3 h-3" />
                {executing ? 'Running...' : 'Run'}
              </button>
            </div>

            {/* Editor */}
            <div className="p-4 shrink-0">
              <SqlEditor
                value={editorValue}
                onChange={setEditorValue}
                language={language}
                placeholder={language === 'redis' ? 'GET mykey' : 'SELECT * FROM ...'}
                onExecute={handleExecute}
                minHeight="160px"
              />
            </div>

            {/* Results */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
                  {error}
                </div>
              )}
              {result && <QueryResultTable result={result} />}
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground/40">Select or create a query</p>
          </div>
        )}
      </div>
    </div>
  );
}
