import { Lock, Save, Info } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { VaultStatus } from "@/api/vault/credentials";

import type { CredentialTemplateField } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

interface FormActionsProps {
  vault: VaultStatus | null;
  fields: CredentialTemplateField[];
  onSave: () => void;
  onCancel: () => void;
  isSaving?: boolean;
  saveDisabled?: boolean;
  saveDisabledReason?: string;
}

export function FormActions({
  vault,
  fields,
  onSave,
  onCancel,
  isSaving,
  saveDisabled,
  saveDisabledReason,
}: FormActionsProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="border-t border-primary/8" />
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {vault && fields.some((f) => f.type === 'password') && (
            <div className="flex items-center gap-1.5 text-sm text-emerald-400/70">
              <Lock className="w-3 h-3" />
              <span>
                {vault.key_source === 'keychain'
                  ? t.vault.credential_forms.encrypted_keychain
                  : t.vault.credential_forms.encrypted_at_rest}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            data-testid="vault-schema-cancel"
            className="px-4 py-2 bg-secondary/60 hover:bg-secondary text-foreground/90 rounded-xl text-sm transition-colors"
          >
            Cancel
          </button>
          <Tooltip content={saveDisabled && saveDisabledReason ? saveDisabledReason : ''} placement="top" delay={200}>
            <button
              onClick={onSave}
              disabled={saveDisabled}
              data-testid="vault-schema-save"
              className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-foreground rounded-xl text-sm font-medium transition-all shadow-elevation-3 shadow-primary/20 disabled:opacity-45 disabled:cursor-not-allowed brightness-lock"
            >
              {isSaving ? (
                <LoadingSpinner />
              ) : (
                <Save className="w-4 h-4" />
              )}
              {isSaving ? 'Saving...' : 'Save Credential'}
            </button>
          </Tooltip>
        </div>
      </div>

      {saveDisabled && saveDisabledReason && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-sm text-amber-300">
          <Info className="w-3.5 h-3.5 shrink-0" />
          <span>{saveDisabledReason}</span>
        </div>
      )}
    </>
  );
}
