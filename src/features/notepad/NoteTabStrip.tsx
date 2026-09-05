import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Archive, Copy, Pencil, Plus, Trash2 } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import { ContextMenu, type ContextMenuItem } from '@/features/shared/components/overlays/ContextMenu';
import { InlineEditableText } from '@/features/shared/components/display/InlineEditableText';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { DevNote } from '@/lib/bindings/DevNote';

import { noteStatusMeta } from './noteStatusMeta';
import type { NoteSaveState } from './notepadStore';

/** Dot colour per save state. `clean` renders nothing — a saved document is
 *  the resting state and does not need a light to say so. */
const SAVE_DOT: Record<Exclude<NoteSaveState, 'clean'>, string> = {
  dirty: 'bg-status-warning/70',
  saving: 'bg-status-info/80 animate-pulse motion-reduce:animate-none',
  error: 'bg-status-error',
};

export interface NoteTabStripProps {
  notes: DevNote[];
  activeId: string | null;
  saveStates: Readonly<Record<string, NoteSaveState>>;
  atCap: boolean;
  onSelect: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onCreate: () => void;
  onFork: (id: string) => void;
  onArchive: (id: string) => void;
  onDelete: (id: string) => void;
  onOpenArchive: () => void;
  /** The region the active tab controls. Rendered by the strip itself — as
   *  `role="tabpanel"` under the tablist — so the tab/panel relationship the
   *  tabs advertise through `aria-controls` resolves inside one component. */
  panel?: ReactNode;
}

interface MenuState {
  x: number;
  y: number;
  noteId: string;
}

/**
 * The note tabs.
 *
 * A real WAI-ARIA tablist, with the same roving-tabindex + arrow-key contract
 * `PanelTabBar` established: only the selected tab is in the Tab order, arrows
 * move within the strip, Home/End jump to the ends. Double-click renames in
 * place (`InlineEditableText`); right-click opens the shared `ContextMenu`.
 *
 * Drag reorder is deliberately out of scope for this pass. `dev_notes.order_index`
 * is UNIQUE, so a future reorder must re-index two-phase (park, then place)
 * rather than assign sequential slots in place.
 */
export function NoteTabStrip({
  notes,
  activeId,
  saveStates,
  atCap,
  onSelect,
  onRename,
  onCreate,
  onFork,
  onArchive,
  onDelete,
  onOpenArchive,
  panel,
}: NoteTabStripProps) {
  const { t, tx } = useTranslation();
  const stripRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  const onKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
    if (notes.length === 0) return;
    e.preventDefault();
    let next: number;
    switch (e.key) {
      case 'ArrowRight':
        next = (index + 1) % notes.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + notes.length) % notes.length;
        break;
      case 'Home':
        next = 0;
        break;
      default:
        next = notes.length - 1;
        break;
    }
    const target = notes[next];
    if (!target) return;
    onSelect(target.id);
    stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')?.[next]?.focus();
  };

  const menuNote = menu ? notes.find((n) => n.id === menu.noteId) : undefined;
  const menuItems: ContextMenuItem[] = menuNote
    ? [
        {
          id: 'rename',
          label: t.notepad.rename,
          icon: <Pencil className="w-3.5 h-3.5" />,
          onSelect: () => setRenamingId(menuNote.id),
        },
        {
          id: 'fork',
          label: t.notepad.fork,
          icon: <Copy className="w-3.5 h-3.5" />,
          disabled: atCap,
          onSelect: () => onFork(menuNote.id),
        },
        // Archive and Delete are mutually exclusive by status, not two ways to
        // do the same thing: a draft has never left, so it can simply go; a
        // note that HAS left is a record and only gets filed away.
        menuNote.status === 'draft'
          ? {
              id: 'delete',
              label: t.notepad.delete,
              icon: <Trash2 className="w-3.5 h-3.5" />,
              danger: true,
              separatorBefore: true,
              onSelect: () => onDelete(menuNote.id),
            }
          : {
              id: 'archive',
              label: t.notepad.archive,
              icon: <Archive className="w-3.5 h-3.5" />,
              separatorBefore: true,
              onSelect: () => onArchive(menuNote.id),
            },
      ]
    : [];

  const newButton = (
    <button
      type="button"
      onClick={onCreate}
      disabled={atCap}
      data-testid="notepad-new-note"
      aria-label={t.notepad.new_note}
      className="w-7 h-7 rounded-input flex items-center justify-center text-foreground/70 hover:text-foreground hover:bg-secondary/50 disabled:is-disabled transition-colors focus-ring"
    >
      <Plus className="w-4 h-4" aria-hidden />
    </button>
  );

  return (
    <>
      <div className="flex items-center gap-1 px-3 h-11 border-b border-primary/10 bg-background/80">
        <div ref={stripRef} role="tablist" aria-label={t.notepad.tabs_label} className="flex items-center gap-1 min-w-0 overflow-x-auto">
          {notes.map((note, index) => {
            const active = note.id === activeId;
            const meta = noteStatusMeta(note.status);
            const StatusIcon = meta.Icon;
            const save = saveStates[note.id] ?? 'clean';
            return (
              <div
                key={note.id}
                role="tab"
                id={`notepad-tab-${note.id}`}
                aria-controls="notepad-panel"
                aria-selected={active}
                tabIndex={active ? 0 : -1}
                data-testid={`notepad-tab-${note.id}`}
                onClick={() => onSelect(note.id)}
                onDoubleClick={() => setRenamingId(note.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelect(note.id);
                    return;
                  }
                  onKeyDown(e, index);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onSelect(note.id);
                  setMenu({ x: e.clientX, y: e.clientY, noteId: note.id });
                }}
                className={`group h-8 px-2.5 rounded-interactive flex items-center gap-1.5 max-w-[200px] cursor-pointer transition-colors focus-ring ${
                  active
                    ? 'bg-primary/10 text-foreground ring-1 ring-primary/25'
                    : 'text-foreground/70 hover:text-foreground hover:bg-secondary/40'
                }`}
              >
                <StatusIcon className="w-3.5 h-3.5 flex-shrink-0 opacity-70" aria-hidden />
                {renamingId === note.id ? (
                  <InlineEditableText
                    value={note.title}
                    onCommit={(title) => {
                      onRename(note.id, title);
                      setRenamingId(null);
                    }}
                    maxLength={120}
                    className="typo-caption"
                    renameLabel={t.notepad.rename}
                    parentGroup
                  />
                ) : (
                  <span className="typo-caption truncate">{note.title}</span>
                )}
                {save !== 'clean' && (
                  <span
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SAVE_DOT[save]}`}
                    data-testid={`notepad-save-${save}`}
                    aria-label={
                      save === 'dirty'
                        ? t.notepad.save_dirty
                        : save === 'saving'
                          ? t.notepad.save_saving
                          : t.notepad.save_error
                    }
                  />
                )}
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-1 ml-1 flex-shrink-0">
          {atCap ? (
            <Tooltip content={tx(t.notepad.cap_reached, { count: notes.length })} triggerFocusable triggerClassName="inline-flex">
              <span className="pointer-events-none inline-flex">{newButton}</span>
            </Tooltip>
          ) : (
            newButton
          )}
          <button
            type="button"
            onClick={onOpenArchive}
            data-testid="notepad-open-archive"
            className="h-7 px-2 rounded-input typo-caption text-foreground/60 hover:text-foreground hover:bg-secondary/50 transition-colors focus-ring"
          >
            {t.notepad.archived_open}
          </button>
        </div>
      </div>

      {panel !== undefined && (
        <div
          role="tabpanel"
          id="notepad-panel"
          aria-labelledby={activeId ? `notepad-tab-${activeId}` : undefined}
          className="flex-1 min-h-0 flex flex-col"
        >
          {panel}
        </div>
      )}

      {menu && menuNote && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={menuItems}
          ariaLabel={menuNote.title}
          widthClass="w-52"
        />
      )}
    </>
  );
}
