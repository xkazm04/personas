import { CheckCircle2, XCircle, Loader2, SkipForward, Plug } from 'lucide-react';
import { ThemedConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { Button } from '@/features/shared/components/buttons';
import type { ConnectorDefinition } from '@/lib/types/types';
import { useTranslation } from '@/i18n/useTranslation';

export type ItemStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface BatchItem {
  connector: ConnectorDefinition;
  status: ItemStatus;
  error?: string;
}

export function StatusIcon({ status, size = 'w-4 h-4' }: { status: ItemStatus; size?: string }) {
  switch (status) {
    case 'done':
      return <CheckCircle2 className={`${size} text-emerald-400`} />;
    case 'failed':
      return <XCircle className={`${size} text-red-400`} />;
    case 'skipped':
      return <SkipForward className={`${size} text-foreground`} />;
    case 'running':
      return <Loader2 className={`${size} text-violet-400 animate-spin`} />;
    default:
      return <div className={`${size} rounded-full border border-primary/20`} />;
  }
}

export function ConnectorLabel({ connector }: { connector: ConnectorDefinition }) {
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
      <span className="text-sm text-foreground truncate">{connector.label}</span>
    </div>
  );
}

interface BatchSummaryProps {
  items: BatchItem[];
  doneCount: number;
  failedCount: number;
  skippedCount: number;
  onDone: () => void;
}

export function BatchSummary({ items, doneCount, failedCount, skippedCount, onDone }: BatchSummaryProps) {
  const { t } = useTranslation();
  return (
    <div className="animate-fade-slide-in space-y-5">
      <div className="text-center py-6">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
          <CheckCircle2 className="w-6 h-6 text-emerald-400" />
        </div>
        <h3 className="text-sm font-bold text-foreground">{t.vault.wizard_detect.batch_complete}</h3>
        <p className="text-sm text-foreground mt-1">
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
            className="flex items-center gap-3 px-3 py-2 rounded-card bg-secondary/20"
          >
            <StatusIcon status={item.status} />
            <ConnectorLabel connector={item.connector} />
            <span className={`text-sm ml-auto ${
              item.status === 'done'
                ? 'text-emerald-400/70'
                : item.status === 'failed'
                  ? 'text-red-400/70'
                  : 'text-foreground'
            }`}>
              {item.status === 'done' ? 'Added' : item.status === 'failed' ? 'Failed' : 'Skipped'}
            </span>
          </div>
        ))}
      </div>

      <div className="flex justify-center">
        <Button
          variant="accent"
          accentColor="emerald"
          size="md"
          onClick={onDone}
        >
          Done
        </Button>
      </div>
    </div>
  );
}
