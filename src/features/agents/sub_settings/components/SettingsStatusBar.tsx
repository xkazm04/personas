import { Trash2, AlertTriangle, Loader2, Check } from 'lucide-react';

interface SettingsStatusBarProps {
  isSaving: boolean;
  isDirty: boolean;
  changedSections: string[];
  showDeleteConfirm: boolean;
  setShowDeleteConfirm: (show: boolean) => void;
  onDelete: () => Promise<void>;
}

export function SettingsStatusBar({
  isSaving,
  isDirty,
  changedSections,
  showDeleteConfirm,
  setShowDeleteConfirm,
  onDelete,
}: SettingsStatusBarProps) {
  return (
    <div className="flex items-center justify-between pt-2 border-t border-primary/10">
      <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
        {isSaving ? (
          <>
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary/70" />
            <span>Saving {changedSections.join(' + ').toLowerCase()}...</span>
          </>
        ) : isDirty ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>{changedSections.join(' + ')} changed</span>
          </>
        ) : (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-400/70" />
            <span className="text-muted-foreground/60">All changes saved</span>
          </>
        )}
      </div>

      {!showDeleteConfirm ? (
        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400/60 hover:text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-sm text-amber-400/70 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" />
            Irreversible
          </span>
          <button
            onClick={onDelete}
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-foreground rounded-xl text-sm font-medium transition-colors"
          >
            Confirm
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-3 py-1.5 bg-secondary/50 text-foreground/80 rounded-xl text-sm transition-colors hover:bg-secondary/70"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
