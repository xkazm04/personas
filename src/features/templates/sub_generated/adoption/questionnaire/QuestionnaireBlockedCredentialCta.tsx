import { AlertCircle, Plus } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';

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
  const { t, tx } = useTranslation();
  return (
    <div className="rounded-card border border-status-error/30 bg-status-error/10 p-4">
      <div className="flex items-start gap-3 mb-3">
        <AlertCircle className="w-5 h-5 text-status-error flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <h4 className="typo-body-lg text-status-error">
            {t.templates.adopt_modal.credentials_required_title}
          </h4>
          <p className="typo-body text-status-error/80 mt-1">
            {tx(t.templates.adopt_modal.credential_required, { category })}
          </p>
        </div>
      </div>
      <Button
        type="button"
        onClick={() => onAddCredential(category)}
        variant="danger"
        size="md"
        className="ml-8"
        icon={<Plus className="w-4 h-4" />}
      >
        {t.templates.adopt_modal.add_credential}
      </Button>
    </div>
  );
}
