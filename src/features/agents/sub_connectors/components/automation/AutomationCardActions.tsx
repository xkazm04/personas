import { useEffect, useRef, useState } from 'react';
import { Pencil, Pause, Play, Trash2, MoreHorizontal } from 'lucide-react';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';
import { useTranslation } from '@/i18n/useTranslation';

interface AutomationCardActionsProps {
  automation: PersonaAutomation;
  onEdit: (id: string) => void;
  onToggleStatus: (id: string, newStatus: 'active' | 'paused') => void;
  onDelete: (id: string) => void;
}

export function AutomationCardActions({
  automation, onEdit, onToggleStatus, onDelete,
}: AutomationCardActionsProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Same disclosure contract as every other menu on the agent surfaces: a
  // click outside or Escape closes it. Without this the menu stayed open
  // until one of its own items was chosen or the trigger was clicked again.
  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen]);

  const handleDelete = () => {
    if (confirmDelete) {
      onDelete(automation.id);
      setConfirmDelete(false);
      setMenuOpen(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={t.common.actions}
        className="flex items-center justify-center w-7 h-7 rounded-card text-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
      >
        <MoreHorizontal className="w-3.5 h-3.5" />
      </button>

      {menuOpen && (
          <div
            role="menu"
            className="animate-fade-slide-in absolute right-0 top-full mt-1 z-[100] w-40 rounded-card border border-border bg-background shadow-elevation-3 py-1"
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => { onEdit(automation.id); setMenuOpen(false); }}
              className="w-full flex items-center gap-2 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/50"
            >
              <Pencil className="w-3 h-3" /> {t.common.edit}
            </button>

            {automation.deploymentStatus === 'active' && (
              <button
                type="button"
                role="menuitem"
                onClick={() => { onToggleStatus(automation.id, 'paused'); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/50"
              >
                <Pause className="w-3 h-3" /> {t.agents.connectors.auto_pause}
              </button>
            )}

            {(automation.deploymentStatus === 'paused' || automation.deploymentStatus === 'draft') && (
              <button
                type="button"
                role="menuitem"
                onClick={() => { onToggleStatus(automation.id, 'active'); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/50"
              >
                <Play className="w-3 h-3" /> {t.agents.connectors.auto_activate}
              </button>
            )}

            <div className="border-t border-border/40 my-1" />

            <button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              className="w-full flex items-center gap-2 px-3 py-1.5 typo-body text-brand-rose hover:bg-brand-rose/10"
            >
              <Trash2 className="w-3 h-3" />
              {confirmDelete ? t.agents.connectors.auto_confirm : t.common.delete}
            </button>
          </div>
        )}
    </div>
  );
}
