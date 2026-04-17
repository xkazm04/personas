import { useState, useCallback, useEffect, useRef } from 'react';
import { SkipForward } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { CatalogAutoSetup } from '@/features/vault/sub_catalog/components/autoCred/steps/CatalogAutoSetup';
import { cancelAutoCredBrowser } from '@/api/vault/autoCredBrowser';
import { silentCatch } from "@/lib/silentCatch";
import type { ConnectorDefinition } from '@/lib/types/types';
import { type BatchItem, type ItemStatus, StatusIcon, BatchSummary } from './BatchHelpers';
import { useTranslation } from '@/i18n/useTranslation';

interface WizardBatchPhaseProps {
  connectors: ConnectorDefinition[];
  onDone: () => void;
}

export function WizardBatchPhase({ connectors, onDone }: WizardBatchPhaseProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<BatchItem[]>(() =>
    connectors.map((c) => ({ connector: c, status: 'pending' as ItemStatus })),
  );
  const [activeIndex, setActiveIndex] = useState(0);

  const activeItem = activeIndex < items.length ? items[activeIndex] : null;
  const isAllDone = items.every((i) => i.status === 'done' || i.status === 'failed' || i.status === 'skipped');

  // Kill running browser session on unmount
  const hasRunningRef = useRef(false);
  useEffect(() => {
    hasRunningRef.current = items.some((i) => i.status === 'running');
  });
  useEffect(() => {
    return () => {
      if (hasRunningRef.current) {
        cancelAutoCredBrowser().catch(silentCatch("WizardBatchPhase:cancelBrowserOnUnmount"));
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

  if (isAllDone) {
    return (
      <BatchSummary
        items={items}
        doneCount={doneCount}
        failedCount={failedCount}
        skippedCount={skippedCount}
        onDone={onDone}
      />
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
        <Button
          variant="ghost"
          size="sm"
          icon={<SkipForward className="w-3.5 h-3.5" />}
          onClick={handleSkip}
          className="text-muted-foreground/80 hover:text-foreground/90"
          title={t.vault.wizard_detect.skip_service}
        >
          Skip
        </Button>
      </div>

      {/* Queue */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {items.map((item, i) => (
          <div
            key={item.connector.id}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-card border text-sm shrink-0 ${
              i === activeIndex
                ? 'border-violet-500/30 bg-violet-500/10 text-violet-300'
                : item.status === 'done'
                  ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-400/70'
                  : item.status === 'failed'
                    ? 'border-red-500/20 bg-red-500/5 text-red-400/70'
                    : item.status === 'skipped'
                      ? 'border-primary/10 bg-secondary/10 text-muted-foreground/70'
                      : 'border-primary/10 bg-secondary/20 text-muted-foreground/80'
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
