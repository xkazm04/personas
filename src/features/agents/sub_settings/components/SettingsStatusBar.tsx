import { Trash2, AlertTriangle, Check } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';

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
  const { t, tx } = useTranslation();
  return (
    <div className="flex items-center justify-between pt-2 border-t border-primary/10">
      <div className="flex items-center gap-2 typo-body text-foreground">
        {isSaving ? (
          <>
            <LoadingSpinner size="sm" className="text-primary/70" />
            <span>{tx(t.agents.settings_status.saving, { sections: changedSections.join(' + ').toLowerCase() })}</span>
          </>
        ) : isDirty ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            <span>{tx(t.agents.settings_status.changed, { sections: changedSections.join(' + ') })}</span>
          </>
        ) : (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-400/70" aria-hidden="true" />
            <span className="text-foreground">{t.agents.settings_status.all_saved}</span>
          </>
        )}
      </div>

      {!showDeleteConfirm ? (
        <button
          onClick={() => setShowDeleteConfirm(true)}
          data-testid="agent-delete-btn"
          className="flex items-center gap-1.5 px-3 py-1.5 typo-body text-red-400/70 hover:text-red-400 hover:bg-red-500/10 rounded-modal transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          {t.common.delete}
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="typo-body text-amber-400/70 flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            {t.agents.settings_status.irreversible}
          </span>
          <button
            onClick={onDelete}
            data-testid="agent-delete-confirm"
            className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-foreground rounded-modal typo-body font-medium transition-colors"
          >
            {t.common.confirm}
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="px-3 py-1.5 bg-secondary/50 text-foreground rounded-modal typo-body transition-colors hover:bg-secondary/70"
          >
            {t.common.cancel}
          </button>
        </div>
      )}
    </div>
  );
}
