import { Save, Trash2, ArrowLeft } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import type { UnsavedGuardAction } from '@/hooks/utility/interaction/useUnsavedGuard';
import { useTranslation } from '@/i18n/useTranslation';
import { InlineErrorBanner } from '@/features/shared/components/feedback/InlineErrorBanner';

interface UnsavedChangesModalProps {
  isOpen: boolean;
  onAction: (action: UnsavedGuardAction) => void;
  /** Optional list of section names that have unsaved changes (e.g. ["Prompt", "Settings"]). */
  changedSections?: string[];
  /** Whether a save is currently in flight. */
  isSaving?: boolean;
  /**
   * Why the last Save failed. While set, the modal stays open and says so -
   * a failed save that silently closed the dialog read as Stay, and the user
   * left believing the write had happened.
   */
  saveError?: string | null;
}

export function UnsavedChangesModal({
  isOpen,
  onAction,
  changedSections = [],
  isSaving = false,
  saveError = null,
}: UnsavedChangesModalProps) {
  const { t } = useTranslation();

  return (
    <BaseModal isOpen={isOpen} onClose={() => onAction('stay')} titleId="unsaved-changes-title" size="sm">
      <div className="p-6 space-y-4">
        <h2 id="unsaved-changes-title" className="typo-heading-lg text-foreground">
          {t.common.unsaved_title}
        </h2>

        <p className="typo-body text-foreground">
          {changedSections.length > 0
            ? (() => {
                const parts = t.common.unsaved_body_sections.split('{sections}');
                return <>{parts[0]}<span className="text-foreground/90 font-medium">{changedSections.join(', ')}</span>{parts[1]}</>;
              })()
            : t.common.unsaved_body}
        </p>

        {saveError && (
          <InlineErrorBanner
            compact
            title={t.common.unsaved_save_failed}
            message={saveError}
          />
        )}

        <div className="flex flex-col gap-2 pt-2">
          <button
            type="button"
            onClick={() => onAction('save')}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 typo-heading rounded-xl bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors duration-snap disabled:opacity-50"
            data-testid="unsaved-guard-save"
          >
            <Save className="w-4 h-4" />
            {isSaving ? t.common.saving : t.common.save_and_continue}
          </button>

          <button
            type="button"
            onClick={() => onAction('discard')}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 typo-heading rounded-xl bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20 transition-colors duration-snap disabled:opacity-50"
            data-testid="unsaved-guard-discard"
          >
            <Trash2 className="w-4 h-4" />
            {t.common.discard_changes}
          </button>

          <button
            type="button"
            onClick={() => onAction('stay')}
            disabled={isSaving}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 typo-heading rounded-xl bg-secondary/50 text-foreground border border-primary/15 hover:bg-secondary/70 transition-colors duration-snap disabled:opacity-50"
            data-testid="unsaved-guard-stay"
          >
            <ArrowLeft className="w-4 h-4" />
            {t.common.stay_on_page}
          </button>
        </div>
      </div>
    </BaseModal>
  );
}
