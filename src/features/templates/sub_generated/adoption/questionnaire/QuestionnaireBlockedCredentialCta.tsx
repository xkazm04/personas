import { AlertCircle, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

/**
 * Replaces the input surface when the current question's vault category
 * has no matching credential. Prompts the user to connect a credential via
 * the adoption wizard's quick-add flow rather than silently skipping the
 * question.
 */
export function QuestionnaireBlockedCredentialCta({
  category,
  onAddCredential,
}: {
  category: string;
  onAddCredential: (vaultCategory: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="rounded-card border border-status-error/30 bg-status-error/10 p-4">
      <div className="flex items-start gap-3 mb-3">
        <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="text-base font-semibold text-status-error">
            {t.templates.adopt_modal.credentials_required_title}
          </h4>
          <p className="text-sm text-status-error/80 leading-relaxed mt-1">
            {t.templates.adopt_modal.credential_required.replace('{category}', category)}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => onAddCredential(category)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-card bg-status-error/15 border border-status-error/40 text-status-error hover:bg-status-error/25 transition-colors ml-8"
      >
        <Plus className="w-4 h-4" />
        {t.templates.adopt_modal.add_credential}
      </button>
    </div>
  );
}
