/* eslint-disable custom/enforce-base-modal --
 * This is an inline popover anchored to a trigger row, not a centered modal.
 * It owns its own Escape + click-outside + ⌘/Ctrl+Enter handling; a BaseModal
 * backdrop / focus-trap / centered layout would be wrong for an anchored edit
 * affordance. role="dialog" + aria-label give it the right semantics. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Save, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface QuickEditPopoverProps {
  open: boolean;
  /** Bounding rect of the trigger the popover anchors to. */
  anchor: DOMRect | null;
  /** Header label (the field being edited). */
  title: string;
  onClose: () => void;
  onSave: () => void;
  saving?: boolean;
  /** Disable Save (e.g. required field empty). Defaults to true. */
  canSave?: boolean;
  /** The field-specific editor. */
  children: React.ReactNode;
}

const POPOVER_WIDTH = 288;
const GAP = 6;

/**
 * @catalog QuickEditPopover — anchored inline-edit popover: header + arbitrary
 * editor body + Save/Cancel, positioned next to a trigger's DOMRect (portalled,
 * viewport-clamped, flips above when tight). Esc / click-out close; ⌘/Ctrl+Enter
 * saves. Pair with a row that captures `e.currentTarget.getBoundingClientRect()`.
 */
export function QuickEditPopover({
  open, anchor, title, onClose, onSave, saving = false, canSave = true, children,
}: QuickEditPopoverProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  // Position below the anchor, clamped to the viewport; flip above when there
  // isn't room below. Measured after the first (hidden) paint.
  useLayoutEffect(() => {
    if (!open || !anchor) { setPos(null); return; }
    const panelH = panelRef.current?.offsetHeight ?? 220;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const top = spaceBelow < panelH + GAP + 8 && anchor.top > spaceBelow
      ? Math.max(8, anchor.top - panelH - GAP)
      : anchor.bottom + GAP;
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - POPOVER_WIDTH - 8));
    setPos({ top, left });
  }, [open, anchor]);

  // Esc closes; click-outside closes; ⌘/Ctrl+Enter saves.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSave && !saving) { e.preventDefault(); onSave(); }
    };
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    // Defer the outside-click listener so the opening click doesn't close it.
    const id = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(id);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, onClose, onSave, canSave, saving]);

  if (!open || !anchor) return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      style={{
        top: pos?.top ?? anchor.bottom + GAP,
        left: pos?.left ?? anchor.left,
        width: POPOVER_WIDTH,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="fixed z-[9995] rounded-modal border border-primary/15 bg-background shadow-elevation-4 overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-primary/10 bg-secondary/15">
        <span className="typo-caption font-medium text-foreground truncate">{title}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.common.cancel}
          className="p-0.5 rounded-interactive text-foreground hover:bg-secondary/40 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-3 space-y-3">{children}</div>

      <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-primary/10 bg-secondary/10">
        <button
          type="button"
          onClick={onClose}
          className="px-2.5 py-1 rounded-interactive typo-caption text-foreground hover:bg-secondary/40 transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSave || saving}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-interactive typo-caption text-primary bg-primary/15 hover:bg-primary/25 border border-primary/25 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Save className="w-3 h-3" />
          {t.common.save}
        </button>
      </div>
    </div>,
    document.body,
  );
}
