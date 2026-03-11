import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle, XCircle, ChevronDown } from 'lucide-react';
import { translateHealthcheckMessage } from '@/features/vault/sub_design/CredentialDesignHelpers';

export function HealthcheckResultDisplay({ success, message }: { success: boolean; message: string }) {
  const [showDetails, setShowDetails] = useState(false);
  const translated = useMemo(() => translateHealthcheckMessage(message), [message]);
  const hasDifferentRaw = translated.raw !== translated.friendly;
  const hasSuggestion = translated.suggestion.length > 0;

  if (success) {
    return (
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: [0.8, 1.08, 1], opacity: 1, boxShadow: ['0 0 0 rgba(16,185,129,0)', '0 0 12px rgba(16,185,129,0.2)', '0 0 0 rgba(16,185,129,0)'] }}
        transition={{ duration: 0.4 }}
        className="mt-2 flex items-start gap-2 px-3 py-2 rounded-xl text-sm bg-status-success/10 border border-status-success/20 text-status-success"
      >
        <CheckCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
        <span>{message}</span>
      </motion.div>
    );
  }

  return (
    <motion.div
      className="mt-2 rounded-xl bg-status-error/10 border border-status-error/20 overflow-hidden"
      animate={{ x: [-4, 4, -3, 3, 0] }}
      transition={{ duration: 0.3 }}
    >
      <div className="flex items-start gap-2 px-3 py-2">
        <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0 text-status-error" />
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-sm text-status-error">{translated.friendly}</p>
          {hasSuggestion && (
            <p className="text-sm text-status-error/60">{translated.suggestion}</p>
          )}
        </div>
      </div>

      {hasDifferentRaw && (
        <div className="border-t border-status-error/10">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 text-sm text-status-error/40 hover:text-status-error/60 transition-colors"
          >
            <ChevronDown className={`w-3 h-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            Technical details
          </button>
          {showDetails && (
            <p className="px-3 pb-2 text-sm text-status-error/30 font-mono break-all">
              {translated.raw}
            </p>
          )}
        </div>
      )}
    </motion.div>
  );
}
