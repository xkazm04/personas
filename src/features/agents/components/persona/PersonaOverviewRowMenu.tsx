import { useState, useRef, useEffect, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, Settings, Trash2 } from 'lucide-react';
import type { Persona } from '@/lib/bindings/Persona';
import { useTranslation } from '@/i18n/useTranslation';

interface RowActionMenuProps {
  persona: Persona;
  onDelete: (id: string) => void;
  onEdit: (id: string) => void;
}

/**
 * Per-row "more" menu rendered into a portal so it escapes the table's
 * sticky header / overflow context. Closes on outside-click and on action.
 */
export function PersonaOverviewRowMenu({ persona, onDelete, onEdit }: RowActionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t)) return;
      if (btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setMenuStyle({
      position: 'fixed',
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
      zIndex: 9999,
    });
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        title={t.agents.persona_list.more_actions}
        className="p-1 rounded-input hover:bg-secondary/40 text-foreground hover:text-muted-foreground/80 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            style={menuStyle}
            className="min-w-[140px] rounded-card border border-primary/15 bg-background shadow-elevation-3 shadow-black/20 py-1 animate-fade-slide-in"
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onEdit(persona.id);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-md text-foreground hover:bg-secondary/40 transition-colors"
            >
              <Settings className="w-3.5 h-3.5" />
              {t.agents.persona_list.settings}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onDelete(persona.id);
              }}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-md text-red-400/80 hover:bg-red-500/10 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              {t.agents.persona_list.batch_delete}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
