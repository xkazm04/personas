import { useState, useMemo } from 'react';
import { CheckCircle, XCircle, ChevronDown } from 'lucide-react';
import { translateHealthcheckMessage } from '@/features/vault/sub_design/CredentialDesignHelpers';

export function HealthcheckResultDisplay({ success, message }: { success: boolean; message: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const translated = useMemo(() => translateHealthcheckMessage(message), [message]);
  const hasDifferentRaw = translated.raw !== translated.friendly;
  const hasSuggestion = translated.suggestion.length > 0;

  if (success) {
    return (
      <div className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl text-sm bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{message}</span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-xl bg-red-500/10 border border-red-500/20 overflow-hidden">
      <div className="flex items-start gap-2 px-3 py-2">
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-red-400" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm text-red-300">{translated.friendly}</p>
          {hasSuggestion && (
            <p className="text-sm text-red-300/60">{translated.suggestion}</p>
          )}
        </div>
      </div>

      {hasDifferentRaw && (
        <div className="border-t border-red-500/10">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-red-400/40 hover:text-red-400/60 transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            Technical details
          </button>
          {showDetails && (
            <p className="px-3 pb-2 text-sm text-red-400/30 font-mono break-all">
              {translated.raw}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
