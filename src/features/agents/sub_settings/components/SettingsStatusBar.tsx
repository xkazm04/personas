import { Trash2, AlertTriangle, Check } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { AsyncButton, Button } from '@/features/shared/components/buttons';

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
      {/* Autosave is the only save path here, so this line is the only confirmation. */}
      <div role="status" aria-live="polite" className="flex items-center gap-2 typo-body text-foreground">
        {isSaving ? (
          <>
            <span>{tx(t.agents.settings_status.saving, { sections: changedSections.join(' + ').toLowerCase() })}</span>
          </>
        ) : isDirty ? (
          <>
            <span className="w-1.5 h-1.5 rounded-full bg-status-warning animate-pulse" />
            <span>{tx(t.agents.settings_status.changed, { sections: changedSections.join(' + ') })}</span>
          </>
        ) : (
          <>
            <Check className="w-3.5 h-3.5 text-status-success" aria-hidden="true" />
            <span className="text-foreground">{t.agents.settings_status.all_saved}</span>
          </>
        )}
      </div>

      {!showDeleteConfirm ? (
        <Button
          variant="accent"
          tone="error"
          size="sm"
          onClick={() => setShowDeleteConfirm(true)}
          data-testid="agent-delete-btn"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          {t.common.delete}
        </Button>
      ) : (
        <div className="flex items-center gap-2">
          <span className="typo-body text-status-warning flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            {t.agents.settings_status.irreversible}
          </span>
          {/* AsyncButton arms its in-flight guard synchronously, so a double press
              sends one delete_persona, not two racing ones. */}
          <AsyncButton
            variant="accent"
            tone="error"
            size="sm"
            onClick={onDelete}
            data-testid="agent-delete-confirm"
          >
            {t.common.confirm}
          </AsyncButton>
          <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(false)}>
            {t.common.cancel}
          </Button>
        </div>
      )}
    </div>
  );
}
