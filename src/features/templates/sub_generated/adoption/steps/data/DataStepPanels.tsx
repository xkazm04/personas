/**
 * DataStep sub-components: ExistingTableCard and SQLPreview.
 */
import { useState } from 'react';
import {
  Database,
  Table2,
  CheckCircle2,
  AlertCircle,
  Play,
  RefreshCw,
  Eye,
  Pencil,
} from 'lucide-react';
import type { IntrospectedTable } from '@/hooks/database/useTableIntrospection';

// -- Table Selection Card ---------------------------------------------

export function ExistingTableCard({
  table,
  selected,
  onToggle,
}: {
  table: IntrospectedTable;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left transition-colors w-full ${
        selected
          ? 'border-violet-500/30 bg-violet-500/10'
          : 'border-primary/10 bg-secondary/10 hover:border-primary/20'
      }`}
    >
      <Table2 className={`w-3.5 h-3.5 flex-shrink-0 ${selected ? 'text-violet-400' : 'text-muted-foreground/50'}`} />
      <span className={`text-sm flex-1 truncate ${selected ? 'text-violet-300 font-medium' : 'text-foreground/80'}`}>
        {table.table_name}
      </span>
      <span className="text-[10px] text-muted-foreground/40 uppercase">{table.table_type}</span>
      {selected && <CheckCircle2 className="w-3.5 h-3.5 text-violet-400 flex-shrink-0" />}
    </button>
  );
}

// -- SQL Preview Panel ------------------------------------------------

export function SQLPreview({
  sql,
  editable,
  onChange,
  onExecute,
  executing,
  executed,
  error,
}: {
  sql: string;
  editable: boolean;
  onChange?: (sql: string) => void;
  onExecute: () => void;
  executing: boolean;
  executed: boolean;
  error: string | null;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10 bg-secondary/20">
        <div className="flex items-center gap-2">
          <Database className="w-3.5 h-3.5 text-cyan-400/70" />
          <span className="text-sm font-medium text-foreground/80">Schema SQL</span>
        </div>
        <div className="flex items-center gap-1.5">
          {editable && !executed && (
            <button
              type="button"
              onClick={() => setEditing(!editing)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] rounded-md text-muted-foreground/60 hover:text-foreground/70 hover:bg-secondary/50 transition-colors"
            >
              {editing ? <Eye className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
              {editing ? 'Preview' : 'Edit'}
            </button>
          )}
          {!executed && (
            <button
              type="button"
              onClick={onExecute}
              disabled={executing || !sql.trim()}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {executing ? (
                <RefreshCw className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3" />
              )}
              {executing ? 'Creating...' : 'Create Tables'}
            </button>
          )}
          {executed && (
            <span className="flex items-center gap-1 px-2 py-1 text-[11px] text-emerald-400">
              <CheckCircle2 className="w-3 h-3" />
              Created
            </span>
          )}
        </div>
      </div>

      {/* SQL content */}
      {editing ? (
        <textarea
          value={sql}
          onChange={(e) => onChange?.(e.target.value)}
          className="w-full h-48 p-3 bg-transparent text-sm text-foreground/80 font-mono resize-y focus-visible:outline-none"
          spellCheck={false}
        />
      ) : (
        <pre className="p-3 text-sm text-foreground/70 font-mono overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
          {sql}
        </pre>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 px-3 py-2 border-t border-red-500/15 bg-red-500/5">
          <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-400/80">{error}</p>
        </div>
      )}
    </div>
  );
}
