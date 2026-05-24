/**
 * Sub-components extracted from ProjectManagerPage:
 *   - ProjectRowMenu — three-dot edit/delete menu for a project table row
 *
 * Goal management lives in the dedicated Goals module (sub_goals); the old
 * GoalBoard was removed from the project manager.
 */
import { useState } from 'react';
import { Trash2, MoreHorizontal, Pencil } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';

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

  return (
    <div className="self-center relative">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); setConfirming(false); }}
        className="p-1 rounded-card text-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => { setOpen(false); setConfirming(false); }} />
          <div className="absolute right-0 top-full mt-1 z-50 w-40 rounded-modal border border-primary/15 bg-background shadow-elevation-3 overflow-hidden py-1">
            <button
              type="button"
              onClick={handleEdit}
              className="w-full flex items-center gap-2 px-3 py-2 typo-caption text-left text-foreground hover:bg-primary/5 transition-colors"
            >
              <Pencil className="w-3 h-3" />
              {t.plugins.dev_projects.edit_project}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className={`w-full flex items-center gap-2 px-3 py-2 typo-caption text-left transition-colors ${
                confirming ? 'bg-red-500/10 text-red-400' : 'text-red-400/70 hover:bg-red-500/5'
              }`}
            >
              <Trash2 className="w-3 h-3" />
              {confirming ? `Delete "${projectName.slice(0, 12)}"?` : 'Delete Project'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
