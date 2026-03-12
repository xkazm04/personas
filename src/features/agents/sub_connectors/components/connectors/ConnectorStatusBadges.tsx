import { Star, ArrowLeftRight, AlertCircle, X, CheckCircle2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { translateHealthcheckMessage } from '@/features/vault/sub_design/CredentialDesignHelpers';
import type { CredentialMetadata } from '@/lib/types/types';
import type { ConnectorStatus } from '../../libs/connectorTypes';

interface LinkPickerProps {
  isLinking: boolean;
  status: ConnectorStatus;
  credentials: CredentialMetadata[];
  onLinkCredential: (connectorName: string, credentialId: string, credentialName: string) => void;
}

export function LinkPicker({ isLinking, status, credentials, onLinkCredential }: LinkPickerProps) {
  const matchingCreds = credentials.filter((c) => c.service_type === status.name);
  const otherCreds = credentials.filter((c) => c.service_type !== status.name);

  return (
    <AnimatePresence>
      {isLinking && (
        <motion.div
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden"
        >
          <div className="mt-3 border border-primary/10 rounded-lg bg-background/40 max-h-48 overflow-y-auto">
            {matchingCreds.length > 0 && (
              <>
                <p className="px-3 py-1.5 text-sm font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-primary/10">Best match</p>
                {matchingCreds.map((cred) => (
                  <button key={cred.id} onClick={() => onLinkCredential(status.name, cred.id, cred.name)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors border-b border-primary/10 last:border-0">
                    <Star className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground/80 truncate" title={cred.name}>{cred.name}</p>
                      <p className="text-sm text-muted-foreground/60">{cred.service_type}</p>
                    </div>
                  </button>
                ))}
              </>
            )}
            {otherCreds.length > 0 && (
              <>
                {matchingCreds.length > 0 && (
                  <p className="px-3 py-1.5 text-sm font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-primary/10">Other credentials</p>
                )}
                {otherCreds.map((cred) => (
                  <button key={cred.id} onClick={() => onLinkCredential(status.name, cred.id, cred.name)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-secondary/40 transition-colors border-b border-primary/10 last:border-0">
                    <div className="w-3 h-3 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground/80 truncate" title={cred.name}>{cred.name}</p>
                      <p className="text-sm text-muted-foreground/60">{cred.service_type}</p>
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface SwapPickerProps {
  swapOpen: boolean;
  alternatives: string[];
  statusName: string;
  onSwap: (currentName: string, newName: string) => void;
  onClose: () => void;
}

export function SwapPicker({ swapOpen, alternatives, statusName, onSwap, onClose }: SwapPickerProps) {
  return (
    <AnimatePresence>
      {swapOpen && alternatives.length > 0 && (
        <motion.div
          initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden"
        >
          <div className="mt-3 border border-sky-500/15 rounded-lg bg-background/40">
            <p className="px-3 py-1.5 text-[11px] font-semibold text-sky-400/50 uppercase tracking-wider border-b border-sky-500/10">Swap to alternative</p>
            {alternatives.map((alt) => (
              <button key={alt} onClick={() => { onSwap(statusName, alt); onClose(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-sky-500/10 transition-colors border-b border-sky-500/5 last:border-0">
                <ArrowLeftRight className="w-3 h-3 text-sky-400/50 flex-shrink-0" />
                <span className="text-sm text-foreground/80">{alt}</span>
              </button>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface StatusResultProps {
  status: ConnectorStatus;
  onClearLinkError?: (connectorName: string) => void;
}

export function StatusResult({ status, onClearLinkError }: StatusResultProps) {
  const translated = status.result && !status.result.success
    ? translateHealthcheckMessage(status.result.message)
    : null;

  return (
    <>
      <AnimatePresence>
        {status.linkError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.15 }} className="overflow-hidden"
          >
            <div className="mt-2.5 px-3 py-2 rounded-xl text-sm bg-amber-500/5 border border-amber-500/15 text-amber-400 flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="flex-1">{status.linkError}</span>
              {onClearLinkError && (
                <button onClick={() => onClearLinkError(status.name)} className="p-0.5 rounded hover:bg-amber-500/15 transition-colors flex-shrink-0">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {status.result && !status.testing && (
        <div className={`mt-2.5 px-3 py-2 rounded-xl text-sm ${
          status.result.success ? 'bg-emerald-500/5 border border-emerald-500/15 text-emerald-400'
            : 'bg-red-500/5 border border-red-500/15 text-red-400'
        }`}>
          {status.result.success ? (
            <div className="flex items-center gap-1.5">
              <CheckCircle2 className="w-3 h-3 flex-shrink-0" />
              <span>{status.result.message}</span>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="flex items-center gap-1.5">
                <XCircle className="w-3 h-3 flex-shrink-0" />
                <span>{translated?.friendly ?? status.result.message}</span>
              </div>
              {translated?.suggestion && (
                <p className="text-sm text-red-400/60 pl-4.5">{translated.suggestion}</p>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
