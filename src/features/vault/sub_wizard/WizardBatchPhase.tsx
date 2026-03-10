import { useState, useCallback, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Loader2, SkipForward, Plug } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { CatalogAutoSetup } from '@/features/vault/sub_autoCred/CatalogAutoSetup';
import { cancelAutoCredBrowser } from '@/api/vault/autoCredBrowser';
import type { ConnectorDefinition } from '@/lib/types/types';

type ItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

interface BatchItem {
  connector: ConnectorDefinition;
  status: ItemStatus;
  error?: string;
}

interface WizardBatchPhaseProps {
  connectors: ConnectorDefinition[];
  onDone: () => void;
}

export function WizardBatchPhase({ connectors, onDone }: WizardBatchPhaseProps) {
  const [items, setItems] = useState<BatchItem[]>(() =>
    connectors.map((c) => ({ connector: c, status: 'pending' as ItemStatus })),
  );
  const [activeIndex, setActiveIndex] = useState(0);

  const activeItem = activeIndex < items.length ? items[activeIndex] : null;
  const isAllDone = items.every((i) => i.status === 'done' || i.status === 'failed' || i.status === 'skipped');

  // Kill running browser session on unmount (e.g. wizard closed while batch is in progress)
  const hasRunningRef = useRef(false);
  useEffect(() => {
    hasRunningRef.current = items.some((i) => i.status === 'running');
  });
  useEffect(() => {
    return () => {
      if (hasRunningRef.current) {
        cancelAutoCredBrowser().catch(() => {});
      }
    };
  }, []);
  const doneCount = items.filter((i) => i.status === 'done').length;
  const failedCount = items.filter((i) => i.status === 'failed').length;
  const skippedCount = items.filter((i) => i.status === 'skipped').length;

  // Mark current item as running when activeIndex changes
  useEffect(() => {
    if (activeIndex < items.length && items[activeIndex]?.status === 'pending') {
      setItems((prev) =>
        prev.map((item, i) => (i === activeIndex ? { ...item, status: 'running' } : item)),
      );
    }
  }, [activeIndex, items.length]);

  const advanceToNext = useCallback(() => {
    const nextIndex = activeIndex + 1;
    if (nextIndex < items.length) {
      setActiveIndex(nextIndex);
    }
    // If no more items, isAllDone will become true
  }, [activeIndex, items.length]);

  const handleComplete = useCallback(() => {
    setItems((prev) =>
      prev.map((item, i) => (i === activeIndex ? { ...item, status: 'done' } : item)),
    );
    advanceToNext();
  }, [activeIndex, advanceToNext]);

  const handleFailed = useCallback(() => {
    setItems((prev) =>
      prev.map((item, i) => (i === activeIndex ? { ...item, status: 'failed' } : item)),
    );
    advanceToNext();
  }, [activeIndex, advanceToNext]);

  const handleSkip = useCallback(() => {
    setItems((prev) =>
      prev.map((item, i) => (i === activeIndex ? { ...item, status: 'skipped' } : item)),
    );
    advanceToNext();
  }, [activeIndex, advanceToNext]);

  // Summary view when all done
  if (isAllDone) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-5"
      >
        <div className="text-center py-6">
          <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
          </div>
          <h3 className="text-sm font-bold text-foreground">Batch setup complete</h3>
          <p className="text-sm text-muted-foreground/80 mt-1">
            {doneCount} added
            {failedCount > 0 ? `, ${failedCount} failed` : ''}
            {skippedCount > 0 ? `, ${skippedCount} skipped` : ''}
          </p>
        </div>

        {/* Results list */}
        <div className="space-y-1.5">
          {items.map((item) => (
            <div
              key={item.connector.id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/20"
            >
              <StatusIcon status={item.status} />
              <ConnectorLabel connector={item.connector} />
              <span className={`text-sm ml-auto ${
                item.status === 'done'
                  ? 'text-emerald-400/70'
                  : item.status === 'failed'
                    ? 'text-red-400/70'
                    : 'text-muted-foreground/50'
              }`}>
                {item.status === 'done' ? 'Added' : item.status === 'failed' ? 'Failed' : 'Skipped'}
              </span>
            </div>
          ))}
        </div>

        <div className="flex justify-center">
          <button
            onClick={onDone}
            className="px-6 py-2.5 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 text-emerald-300 rounded-xl text-sm font-medium transition-colors"
          >
            Done
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">
            Setting up {activeIndex + 1} of {items.length}
          </h3>
          <p className="text-sm text-muted-foreground/70">
            {activeItem?.connector.label}
          </p>
        </div>
        <button
          onClick={handleSkip}
          className="flex items-center gap-1.5 text-sm text-muted-foreground/60 hover:text-foreground/80 transition-colors"
          title="Skip this service"
        >
          <SkipForward className="w-3.5 h-3.5" />
          Skip
        </button>
      </div>

      {/* Queue */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {items.map((item, i) => (
          <div
            key={item.connector.id}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-sm shrink-0 ${
              i === activeIndex
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                : item.status === 'done'
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400/70'
                  : item.status === 'failed'
                    ? 'border-red-500/20 bg-red-500/5 text-red-400/70'
                    : item.status === 'skipped'
                      ? 'border-primary/10 bg-secondary/10 text-muted-foreground/40'
                      : 'border-primary/10 bg-secondary/20 text-muted-foreground/50'
            }`}
          >
            <StatusIcon status={item.status} size="w-3 h-3" />
            <span className="truncate max-w-[80px]">{item.connector.label}</span>
          </div>
        ))}
      </div>

      {/* Active auto-setup */}
      {activeItem && activeItem.status === 'running' && (
        <CatalogAutoSetup
          connector={activeItem.connector}
          onComplete={handleComplete}
          onCancel={handleFailed}
        />
      )}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────

function StatusIcon({ status, size = 'w-4 h-4' }: { status: ItemStatus; size?: string }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className={`${size} text-emerald-400`} />;
    case 'failed':
      return <XCircle className={`${size} text-red-400`} />;
    case 'skipped':
      return <SkipForward className={`${size} text-muted-foreground/40`} />;
    case 'running':
      return <Loader2 className={`${size} text-violet-400 animate-spin`} />;
    default:
      return <div className={`${size} rounded-full border border-primary/20`} />;
  }
}

function ConnectorLabel({ connector }: { connector: ConnectorDefinition }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <div
        className="w-5 h-5 rounded flex items-center justify-center shrink-0"
        style={{
          backgroundColor: `${connector.color}15`,
          border: `1px solid ${connector.color}25`,
        }}
      >
        {connector.icon_url ? (
          <ThemedConnectorIcon url={connector.icon_url} label={connector.label} color={connector.color} size="w-3 h-3" />
        ) : (
          <Plug className="w-2.5 h-2.5" style={{ color: connector.color }} />
        )}
      </div>
      <span className="text-sm text-foreground/80 truncate">{connector.label}</span>
    </div>
  );
}
