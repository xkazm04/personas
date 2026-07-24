// Shared by both manager-page directions: rename / recolour / delete for one
// workspace. Extracted the moment the second variant needed it so a tweak to
// the edit affordances lands once, not twice.
import { useEffect, useRef, useState } from 'react';
import { Check, Trash2 } from 'lucide-react';

import { deleteWorkspace, recolorWorkspace, renameWorkspace, WORKSPACE_COLORS, type Workspace } from './workspaceStore';

const COPY = {
  namePlaceholder: 'Workspace name',
  delete: 'Delete workspace',
  deleteConfirm: 'Delete — projects stay',
  done: 'Done',
};

export function WorkspaceEditMenu({ ws, onClose, className = '' }: {
  ws: Workspace;
  onClose: () => void;
  /** Positioning classes from the caller (rail anchors left, tabs anchor below). */
  className?: string;
}) {
  const [name, setName] = useState(ws.name);
  const [confirming, setConfirming] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const commitName = () => {
    if (name.trim() && name.trim() !== ws.name) renameWorkspace(ws.id, name);
  };

  return (
    <div
      ref={ref}
      className={`z-40 w-[236px] p-2.5 rounded-card border border-primary/20 bg-secondary/95 backdrop-blur-sm shadow-elevation-4 space-y-2 ${className}`}
      onClick={(e) => e.stopPropagation()}
      data-testid={`workspace-edit-${ws.id}`}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commitName(); onClose(); }
        }}
        placeholder={COPY.namePlaceholder}
        className="w-full px-2.5 py-1.5 typo-caption rounded-input bg-background/70 border border-primary/15 text-foreground outline-none focus:border-primary/40"
      />
      <div className="flex items-center gap-1.5 flex-wrap">
        {WORKSPACE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => recolorWorkspace(ws.id, c)}
            aria-label={`Colour ${c}`}
            className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110 focus-ring"
            style={{ background: c, borderColor: ws.color === c ? 'var(--foreground)' : 'transparent' }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => {
            if (!confirming) { setConfirming(true); return; }
            deleteWorkspace(ws.id);
            onClose();
          }}
          className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-interactive typo-caption transition-colors focus-ring ${
            confirming
              ? 'bg-status-error/15 text-status-error'
              : 'text-status-error/80 hover:bg-status-error/10 hover:text-status-error'
          }`}
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden />
          {confirming ? COPY.deleteConfirm : COPY.delete}
        </button>
        <button
          type="button"
          onClick={() => { commitName(); onClose(); }}
          aria-label={COPY.done}
          className="ml-auto p-1.5 rounded-interactive text-primary hover:bg-primary/10 transition-colors focus-ring"
        >
          <Check className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}
