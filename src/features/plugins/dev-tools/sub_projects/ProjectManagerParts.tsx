/**
 * Sub-components extracted from ProjectManagerPage:
 *   - ProjectRowMenu — three-dot edit/delete menu for a project table row
 *
 * Goal management lives in the dedicated Goals module (sub_goals); the old
 * GoalBoard was removed from the project manager.
 */
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Trash2, MoreHorizontal, Pencil } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { useAnchoredPortalPosition } from '@/features/shared/components/forms/useAnchoredPortalPosition';

/** Fixed menu width — needed up front to right-align the portal to the trigger. */
const MENU_WIDTH = 160;

// ---------------------------------------------------------------------------
// ProjectRowMenu
// ---------------------------------------------------------------------------

export function ProjectRowMenu({
  projectId,
  projectName,
  onEdit,
}: {
  projectId: string;
  projectName: string;
  onEdit: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const deleteProject = useSystemStore((s) => s.deleteProject);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // Portalled to document.body rather than positioned in-row. UnifiedTable's
  // root is `overflow-hidden` and its body `overflow-y-auto`, and focused rows
  // take `z-[1]` — so an in-row `absolute z-50` menu is clipped by the table and
  // trapped in the row's stacking context no matter how high the z-index goes.
  // `flip` keeps the last rows' menus on screen by opening upward.
  const pos = useAnchoredPortalPosition(triggerRef, open, { flip: true, maxMenuHeight: 96, gap: 4 });

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen(false);
    onEdit();
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    await deleteProject(projectId);
    setOpen(false);
    setConfirming(false);
  };

  const close = () => { setOpen(false); setConfirming(false); };

  return (
    <div className="self-center relative">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.plugins.dev_projects.edit_project}
        onClick={(e) => { e.stopPropagation(); setOpen(!open); setConfirming(false); }}
        className="p-1 rounded-card text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && pos && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9989 }} onClick={close} />
          <div
            role="menu"
            onClick={(e) => e.stopPropagation()}
            className="rounded-modal border border-primary/15 bg-background shadow-elevation-3 overflow-hidden py-1"
            style={{
              position: 'fixed',
              // Right-aligned to the trigger: the hook anchors left, and this
              // menu is wider than the icon button it hangs off.
              left: pos.left + pos.width - MENU_WIDTH,
              top: pos.top,
              width: MENU_WIDTH,
              transform: pos.flipUp ? 'translateY(-100%)' : undefined,
              zIndex: 9990,
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={handleEdit}
              className="w-full flex items-center gap-2 px-3 py-2 typo-caption text-left text-foreground hover:bg-primary/5 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {t.plugins.dev_projects.edit_project}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={handleDelete}
              className={`w-full flex items-center gap-2 px-3 py-2 typo-caption text-left transition-colors ${
                confirming ? 'bg-red-500/10 text-red-400' : 'text-red-400/70 hover:bg-red-500/5'
              }`}
            >
              <Trash2 className="w-3 h-3" />
              {confirming ? `Delete "${projectName.slice(0, 12)}"?` : 'Delete Project'}
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
