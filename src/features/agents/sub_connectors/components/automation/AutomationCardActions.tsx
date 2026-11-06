import { useEffect, useRef, useState } from 'react';
import { Pencil, Pause, Play, Trash2, MoreHorizontal } from 'lucide-react';
import type { PersonaAutomation } from '@/lib/bindings/PersonaAutomation';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

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

  // One click hands off to the section's confirm dialog (it names the
  // automation and shows the blast radius). An inline "Confirm" second click
  // used to sit in front of it, making delete a three-step act.
  const handleDelete = () => {
    onDelete(automation.id);
    setMenuOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        onClick={() => setMenuOpen(!menuOpen)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={t.common.actions}
        variant="ghost"
        size="icon-sm"
        icon={<MoreHorizontal className="w-3.5 h-3.5" />}
      />

      {menuOpen && (
          <div
            role="menu"
            className="animate-fade-slide-in absolute right-0 top-full mt-1 z-[100] w-40 rounded-card border border-hair bg-background shadow-elevation-3 py-1"
          >
            <Button
              type="button"
              role="menuitem"
              onClick={() => { onEdit(automation.id); setMenuOpen(false); }}
              variant="ghost"
              size="sm"
              className="w-full"
              icon={<Pencil className="w-3 h-3" />}
            >{t.common.edit}</Button>

            {automation.deploymentStatus === 'active' && (
              <Button
                type="button"
                role="menuitem"
                onClick={() => { onToggleStatus(automation.id, 'paused'); setMenuOpen(false); }}
                variant="ghost"
                size="sm"
                className="w-full"
                icon={<Pause className="w-3 h-3" />}
              >{t.agents.connectors.auto_pause}</Button>
            )}

            {(automation.deploymentStatus === 'paused' || automation.deploymentStatus === 'draft') && (
              <Button
                type="button"
                role="menuitem"
                onClick={() => { onToggleStatus(automation.id, 'active'); setMenuOpen(false); }}
                variant="ghost"
                size="sm"
                className="w-full"
                icon={<Play className="w-3 h-3" />}
              >{t.agents.connectors.auto_activate}</Button>
            )}

            <div className="border-t border-hair my-1" />

            <Button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              variant="ghost"
              size="sm"
              className="w-full"
              icon={<Trash2 className="w-3 h-3" />}
            >{t.common.delete}</Button>
          </div>
        )}
    </div>
  );
}
