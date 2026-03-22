import { useState } from 'react';
import { ChevronDown, ChevronRight, Pencil, FilePlus, Eye } from 'lucide-react';
import type { TrackedFileChange } from '@/hooks/execution/useFileChanges';

interface FileChangesPanelProps {
  changes: Map<string, TrackedFileChange>;
  editedCount: number;
  createdCount: number;
  readCount: number;
}

function shortPath(fullPath: string): string {
  const parts = fullPath.replace(/\\/g, '/').split('/');
  return parts.length > 3
    ? `…/${parts.slice(-3).join('/')}`
    : parts.join('/');
}

export function FileChangesPanel({ changes, editedCount, createdCount, readCount }: FileChangesPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const total = editedCount + createdCount + readCount;

  if (total === 0) return null;

  return (
    <div className="border-b border-border/20 bg-muted/20">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground transition-colors"
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="font-medium">Files</span>
        {editedCount > 0 && (
          <span className="flex items-center gap-0.5 text-amber-400/70">
            <Pencil className="w-2.5 h-2.5" /> {editedCount}
          </span>
        )}
        {createdCount > 0 && (
          <span className="flex items-center gap-0.5 text-emerald-400/70">
            <FilePlus className="w-2.5 h-2.5" /> {createdCount}
          </span>
        )}
        {readCount > 0 && (
          <span className="flex items-center gap-0.5 text-muted-foreground/50">
            <Eye className="w-2.5 h-2.5" /> {readCount}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-0.5 max-h-40 overflow-y-auto">
          {Array.from(changes.values())
            .sort((a, b) => {
              // Sort: edited first, then created, then read
              const priority = (c: TrackedFileChange) =>
                c.types.has('edit') ? 0 : c.types.has('write') ? 1 : 2;
              return priority(a) - priority(b);
            })
            .map((change) => {
              const isEdit = change.types.has('edit');
              const isWrite = change.types.has('write') && !isEdit;
              return (
                <div
                  key={change.path}
                  className="flex items-center gap-1.5 text-xs font-mono"
                  title={change.path}
                >
                  {isEdit ? (
                    <Pencil className="w-2.5 h-2.5 text-amber-400/60 flex-shrink-0" />
                  ) : isWrite ? (
                    <FilePlus className="w-2.5 h-2.5 text-emerald-400/60 flex-shrink-0" />
                  ) : (
                    <Eye className="w-2.5 h-2.5 text-muted-foreground/40 flex-shrink-0" />
                  )}
                  <span className={`truncate ${
                    isEdit ? 'text-amber-400/60' : isWrite ? 'text-emerald-400/60' : 'text-muted-foreground/40'
                  }`}>
                    {shortPath(change.path)}
                  </span>
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}
