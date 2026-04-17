import { useState, useMemo } from 'react';
import { CheckCircle, XCircle, ChevronDown } from 'lucide-react';
import { translateHealthcheckMessage } from '@/features/vault/sub_catalog/components/design/CredentialDesignHelpers';
import { useTranslation } from '@/i18n/useTranslation';

export function HealthcheckResultDisplay({ success, message }: { success: boolean; message: string }) {
  const { t } = useTranslation();
  const [showDetails, setShowDetails] = useState(false);
  const translated = useMemo(() => translateHealthcheckMessage(message), [message]);
  const hasDifferentRaw = translated.raw !== translated.friendly;
  const hasSuggestion = translated.suggestion.length > 0;

  if (success) {
    return (
      <div
        className="animate-fade-slide-in mt-2 flex items-start gap-2 px-3 py-2 rounded-modal typo-body bg-status-success/10 border border-status-success/20 text-status-success"
      >
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div
      className="animate-fade-in mt-2 rounded-modal bg-status-error/10 border border-status-error/20 overflow-hidden"
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-status-error" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="typo-body text-status-error">{translated.friendly}</p>
          {hasSuggestion && (
            <p className="typo-body text-status-error/60">{translated.suggestion}</p>
          )}
        </div>
      </div>

      {hasDifferentRaw && (
        <div className="border-t border-status-error/10">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 typo-body text-status-error/40 hover:text-status-error/60 transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            {t.vault.forms.technical_details}
          </button>
          {showDetails && (
            <p className="px-3 pb-2 typo-code text-status-error/30 font-mono break-all">
              {translated.raw}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
