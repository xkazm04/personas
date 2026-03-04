import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ExternalLink, Plug } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/ConnectorMeta';
import { openExternalUrl } from '@/api/tauriApi';
import type { ConnectorDefinition } from '@/lib/types/types';

interface SetupGuideModalProps {
  connector: ConnectorDefinition | null;
  onClose: () => void;
}

export function SetupGuideModal({ connector, onClose }: SetupGuideModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!connector) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [connector, onClose]);

  if (!connector) return null;

  const metadata = (connector.metadata ?? {}) as Record<string, unknown>;
  const guide = typeof metadata.setup_guide === 'string' ? metadata.setup_guide : null;
  const docsUrl = typeof metadata.docs_url === 'string' ? metadata.docs_url : null;
  const authLabel = typeof metadata.auth_type_label === 'string' ? metadata.auth_type_label : 'Credential';
  const summary = typeof metadata.summary === 'string' ? metadata.summary : null;

  const handleOpenDocs = async () => {
    if (!docsUrl) return;
    try {
      await openExternalUrl(docsUrl);
    } catch {
      window.open(docsUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        ref={backdropRef}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={(e) => e.target === backdropRef.current && onClose()}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          className="relative w-full max-w-lg mx-4 rounded-2xl border border-primary/15 bg-background shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-4 border-b border-primary/10 bg-secondary/20">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center border"
              style={{
                backgroundColor: `${connector.color}15`,
                borderColor: `${connector.color}30`,
              }}
            >
              {connector.icon_url ? (
                <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-5 h-5" />
              ) : (
                <Plug className="w-5 h-5" style={{ color: connector.color }} />
              )}
            </div>
            <div className="flex-1">
              <h3 className="font-semibold text-foreground">How to get {connector.label} {authLabel}</h3>
              {summary && (
                <p className="text-xs text-muted-foreground/70 mt-0.5">{summary}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground/60" />
            </button>
          </div>

          {/* Body */}
          <div className="px-6 py-5 space-y-4">
            {guide ? (
              <div className="space-y-2.5">
                {guide.split('\n').filter(Boolean).map((line, i) => {
                  const stripped = line.replace(/^\d+\.\s*/, '');
                  const stepNum = i + 1;
                  return (
                    <div key={i} className="flex gap-3">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary/80">
                        {stepNum}
                      </span>
                      <p className="text-sm text-foreground/85 pt-0.5 leading-relaxed">{stripped}</p>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground/70">
                No setup guide available for this connector. Visit the documentation link below for instructions.
              </p>
            )}

            {/* Required fields hint */}
            {connector.fields.length > 0 && (
              <div className="pt-2 border-t border-primary/8">
                <p className="text-xs text-muted-foreground/50 mb-2">Required fields:</p>
                <div className="flex flex-wrap gap-1.5">
                  {connector.fields.filter((f) => f.required).map((f) => (
                    <span key={f.key} className="text-xs px-2 py-0.5 rounded-md bg-secondary/40 border border-primary/10 text-foreground/70 font-mono">
                      {f.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          {docsUrl && (
            <div className="px-6 py-3 border-t border-primary/10 bg-secondary/10">
              <button
                onClick={handleOpenDocs}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary text-sm font-medium transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Open {connector.label} setup page
              </button>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
