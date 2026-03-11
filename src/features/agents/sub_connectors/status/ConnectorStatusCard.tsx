import { useState } from 'react';
import { Link, CheckCircle2, AlertCircle, XCircle, Activity, Loader2, ChevronDown, Star, Plus, X, ArrowLeftRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { translateHealthcheckMessage } from '@/features/vault/sub_design/CredentialDesignHelpers';
import type { ConnectorStatus } from '../libs/connectorTypes';
import { STATUS_CONFIG, getStatusKey } from '../libs/connectorTypes';
import type { CredentialMetadata } from '@/lib/types/types';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { Button } from '@/features/shared/components/buttons';

interface ConnectorStatusCardProps {
  status: ConnectorStatus;
  isLinking: boolean;
  credentials: CredentialMetadata[];
  onTest: (name: string, credentialId: string) => void;
  onToggleLinking: (name: string | null) => void;
  onLinkCredential: (connectorName: string, credentialId: string, credentialName: string) => void;
  onAddCredential: (connectorName: string) => void;
  onClearLinkError?: (connectorName: string) => void;
  /** Role label for this connector's functional slot */
  roleLabel?: string;
  /** Alternative connectors that fill the same role */
  alternatives?: string[];
  /** Called when user wants to swap to an alternative connector */
  onSwap?: (currentName: string, newName: string) => void;
}

const STATUS_ICON = {
  testing: Loader2,
  ready: CheckCircle2,
  failed: XCircle,
  missing: AlertCircle,
  untested: AlertCircle,
} as const;

export function ConnectorStatusCard({
  status,
  isLinking,
  credentials,
  onTest,
  onToggleLinking,
  onLinkCredential,
  onAddCredential,
  onClearLinkError,
  roleLabel,
  alternatives,
  onSwap,
}: ConnectorStatusCardProps) {
  const [swapOpen, setSwapOpen] = useState(false);
  const statusKey = getStatusKey(status);
  const config = STATUS_CONFIG[statusKey];
  const translated = status.result && !status.result.success
    ? translateHealthcheckMessage(status.result.message)
    : null;
  const matchingCreds = credentials.filter((c) => c.service_type === status.name);
  const otherCreds = credentials.filter((c) => c.service_type !== status.name);

  return (
    <SectionCard size="md">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center flex-shrink-0">
          <Link className="w-3.5 h-3.5 text-emerald-400/60" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground/80 truncate" title={status.name}>{status.name}</p>
            {roleLabel && (
              <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded bg-sky-500/10 border border-sky-500/15 text-sky-400/70 whitespace-nowrap">
                {roleLabel}
              </span>
            )}
            <motion.div layout transition={{ type: 'spring', stiffness: 300 }}>
              <AnimatePresence mode="wait" initial={false}>
                <motion.span
                  key={statusKey}
                  layout
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, ease: 'easeInOut', layout: { type: 'spring', stiffness: 300 } }}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-sm font-medium rounded-full border ${config.bg} ${config.color}`}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={`icon-${statusKey}`}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.9 }}
                      transition={{ duration: 0.3, ease: 'easeInOut' }}
                      className="inline-flex"
                    >
                      {(() => {
                        const Icon = STATUS_ICON[statusKey];
                        return <Icon className={`w-2.5 h-2.5 ${statusKey === 'testing' ? 'animate-spin' : ''}`} />;
                      })()}
                    </motion.span>
                  </AnimatePresence>
                  <motion.span layout transition={{ type: 'spring', stiffness: 300 }}>{config.label}</motion.span>
                </motion.span>
              </AnimatePresence>
            </motion.div>
          </div>
          {status.credentialName && (
            <p className="text-sm text-muted-foreground/80 mt-0.5">
              Credential: {status.credentialName}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {alternatives && alternatives.length > 0 && onSwap && (
            <Button
              variant={swapOpen ? 'accent' : 'ghost'}
              size="icon-sm"
              icon={<ArrowLeftRight className="w-3 h-3" />}
              onClick={() => setSwapOpen((o) => !o)}
              title="Swap to alternative connector"
              className={swapOpen
                ? 'border-sky-500/30 text-sky-300 bg-sky-500/15'
                : 'border-primary/15 text-muted-foreground/60 hover:bg-secondary/50 hover:text-foreground/80'
              }
            />
          )}
          {status.credentialId ? (
            <Button
              variant="ghost"
              size="sm"
              icon={status.testing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Activity className="w-3 h-3" />}
              onClick={() => onTest(status.name, status.credentialId!)}
              disabled={status.testing}
              className="border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95"
            >
              Test
            </Button>
          ) : (
            <>
              {credentials.length > 0 && (
                <Button
                  variant={isLinking ? 'accent' : 'ghost'}
                  size="sm"
                  icon={<ChevronDown className={`w-3 h-3 transition-transform ${isLinking ? 'rotate-180' : ''}`} />}
                  onClick={() => onToggleLinking(isLinking ? null : status.name)}
                  className={isLinking
                    ? 'border-violet-500/30 text-violet-300 bg-violet-500/15'
                    : 'border border-primary/15 text-muted-foreground/80 hover:bg-secondary/50 hover:text-foreground/95'
                  }
                >
                  Link Existing
                </Button>
              )}
              <Button
                variant="accent"
                size="sm"
                icon={<Plus className="w-3 h-3" />}
                onClick={() => onAddCredential(status.name)}
                className="border-violet-500/25 text-violet-300 bg-violet-500/10 hover:bg-violet-500/20"
              >
                Add New
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Link picker */}
      <AnimatePresence>
        {isLinking && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-3 border border-primary/10 rounded-lg bg-background/40 max-h-48 overflow-y-auto">
              {matchingCreds.length > 0 && (
                <>
                  <p className="px-3 py-1.5 text-sm font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-primary/5">Best match</p>
                  {matchingCreds.map((cred) => (
                    <Button
                      key={cred.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => onLinkCredential(status.name, cred.id, cred.name)}
                      className="w-full justify-start px-3 py-2 text-left hover:bg-secondary/40 border-b border-primary/5 last:border-0"
                    >
                      <Star className="w-3 h-3 text-amber-400/60 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground/80 truncate" title={cred.name}>{cred.name}</p>
                        <p className="text-sm text-muted-foreground/60">{cred.service_type}</p>
                      </div>
                    </Button>
                  ))}
                </>
              )}
              {otherCreds.length > 0 && (
                <>
                  {matchingCreds.length > 0 && (
                    <p className="px-3 py-1.5 text-sm font-semibold text-muted-foreground/50 uppercase tracking-wider border-b border-primary/5">Other credentials</p>
                  )}
                  {otherCreds.map((cred) => (
                    <Button
                      key={cred.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => onLinkCredential(status.name, cred.id, cred.name)}
                      className="w-full justify-start px-3 py-2 text-left hover:bg-secondary/40 border-b border-primary/5 last:border-0"
                    >
                      <div className="w-3 h-3 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground/80 truncate" title={cred.name}>{cred.name}</p>
                        <p className="text-sm text-muted-foreground/60">{cred.service_type}</p>
                      </div>
                    </Button>
                  ))}
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swap picker */}
      <AnimatePresence>
        {swapOpen && alternatives && alternatives.length > 0 && onSwap && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-3 border border-sky-500/15 rounded-lg bg-background/40">
              <p className="px-3 py-1.5 text-[11px] font-semibold text-sky-400/50 uppercase tracking-wider border-b border-sky-500/10">
                Swap to alternative
              </p>
              {alternatives.map((alt) => (
                <Button
                  key={alt}
                  variant="ghost"
                  size="sm"
                  icon={<ArrowLeftRight className="w-3 h-3 text-sky-400/50" />}
                  onClick={() => { onSwap(status.name, alt); setSwapOpen(false); }}
                  className="w-full justify-start px-3 py-2 text-left hover:bg-sky-500/10 border-b border-sky-500/5 last:border-0"
                >
                  <span className="text-sm text-foreground/80">{alt}</span>
                </Button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Link error toast */}
      <AnimatePresence>
        {status.linkError && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            <div className="mt-2.5 px-3 py-2 rounded-xl text-sm bg-amber-500/5 border border-amber-500/15 text-amber-400 flex items-start gap-1.5">
              <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
              <span className="flex-1">{status.linkError}</span>
              {onClearLinkError && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  icon={<X className="w-3 h-3" />}
                  onClick={() => onClearLinkError(status.name)}
                  className="p-0.5 hover:bg-amber-500/15 flex-shrink-0"
                />
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result detail */}
      {status.result && !status.testing && (
        <div className={`mt-2.5 px-3 py-2 rounded-xl text-sm ${
          status.result.success
            ? 'bg-emerald-500/5 border border-emerald-500/15 text-emerald-400'
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
    </SectionCard>
  );
}
