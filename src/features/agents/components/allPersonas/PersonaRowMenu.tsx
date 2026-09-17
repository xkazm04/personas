import { useCallback, useRef, useState } from 'react';
import { Copy, Download, MoreHorizontal } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useClickOutside } from '@/hooks/utility/interaction/useClickOutside';
import type { Persona } from '@/lib/bindings/Persona';

interface PersonaRowMenuProps {
  persona: Persona;
  onDuplicate: (id: string) => Promise<void> | void;
  onExport: (id: string) => Promise<void> | void;
}

/**
 * Per-row overflow for the roster: Duplicate and Export.
 *
 * The roster could previously only delete, archive and restore; duplicate lived
 * exclusively in the Command Palette and export had no UI caller at all. Both
 * are now row actions the way delete already is, so making a variant or handing
 * an agent to a teammate does not require knowing a keyboard shortcut.
 */
export function PersonaRowMenu({ persona, onDuplicate, onExport }: PersonaRowMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  // Shared dismissal contract (outside press + Escape together) rather than a
  // per-site pair of document listeners.
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, open, close);

  return (
    <div ref={ref} className="relative flex items-center justify-center w-full h-full">
      <button
        type="button"
        data-testid={`persona-row-menu-${persona.id}`}
        aria-label={t.agents.persona_list.more_actions}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="p-1 rounded-interactive text-foreground hover:bg-primary/[0.06] transition-colors focus-ring cursor-pointer"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full mt-1 z-50 w-44 rounded-card border border-primary/15 bg-background shadow-elevation-3 p-1"
          onClick={(e) => e.stopPropagation()}
        >
          <AsyncButton
            variant="ghost"
            size="sm"
            block
            role="menuitem"
            icon={<Copy className="w-3.5 h-3.5" />}
            data-testid={`persona-row-duplicate-${persona.id}`}
            onClick={async () => {
              await onDuplicate(persona.id);
              setOpen(false);
            }}
            className="justify-start"
          >
            {t.common.duplicate}
          </AsyncButton>
          <AsyncButton
            variant="ghost"
            size="sm"
            block
            role="menuitem"
            icon={<Download className="w-3.5 h-3.5" />}
            data-testid={`persona-row-export-${persona.id}`}
            onClick={async () => {
              await onExport(persona.id);
              setOpen(false);
            }}
            className="justify-start"
          >
            {t.settings.portability.export}
          </AsyncButton>
        </div>
      )}
    </div>
  );
}
