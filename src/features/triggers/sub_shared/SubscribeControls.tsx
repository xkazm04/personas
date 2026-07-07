import { useCallback, useState } from 'react';
import { Check, History, Plus } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { SharedEventSubscription } from '@/lib/bindings/SharedEventSubscription';

/**
 * Shared subscribe/watch/history row controls for the Marketplace table
 * variants. The busy-guard mirrors CatalogCard: subscribe/unsubscribe are async
 * and the control stays interactive, so without an in-flight lock a double-click
 * races two mutations into a wrong final state.
 */
function useSubscribeToggle(
  entryId: string,
  subscription: SharedEventSubscription | undefined,
  subscribe: (entryId: string) => Promise<void>,
  unsubscribe: (subId: string) => Promise<void>,
) {
  const [busy, setBusy] = useState(false);
  const subscribed = !!subscription;
  const toggle = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (subscription) await unsubscribe(subscription.id);
      else await subscribe(entryId);
    } finally {
      setBusy(false);
    }
  }, [busy, subscription, entryId, subscribe, unsubscribe]);
  return { subscribed, busy, toggle };
}

interface ControlProps {
  entryId: string;
  subscription: SharedEventSubscription | undefined;
  subscribe: (entryId: string) => Promise<void>;
  unsubscribe: (subId: string) => Promise<void>;
}

/** Pill button — Subscribe / Subscribed (hover → Unsubscribe). Registry variant. */
export function SubscribeButton({ entryId, subscription, subscribe, unsubscribe }: ControlProps) {
  const { t } = useTranslation();
  const m = t.triggers.marketplace;
  const { subscribed, busy, toggle } = useSubscribeToggle(entryId, subscription, subscribe, unsubscribe);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); void toggle(); }}
      disabled={busy}
      className={`group/sub inline-flex items-center gap-1 px-2.5 py-1 typo-caption font-medium rounded-input transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
        subscribed
          ? 'bg-status-success/10 text-status-success hover:bg-status-error/10 hover:text-status-error'
          : 'bg-primary/10 text-primary hover:bg-primary/20'
      }`}
    >
      {subscribed ? (
        <>
          <Check className="w-3 h-3 group-hover/sub:hidden" />
          <span className="group-hover/sub:hidden">{m.subscribed}</span>
          <span className="hidden group-hover/sub:inline">{m.unsubscribe}</span>
        </>
      ) : (
        <>
          <Plus className="w-3 h-3" />
          {m.subscribe}
        </>
      )}
    </button>
  );
}

/** Switch — Watch / Watching. Watchtower variant. */
export function WatchToggle({ entryId, subscription, subscribe, unsubscribe }: ControlProps) {
  const { t } = useTranslation();
  const m = t.triggers.marketplace;
  const { subscribed, busy, toggle } = useSubscribeToggle(entryId, subscription, subscribe, unsubscribe);
  return (
    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
      <AccessibleToggle
        checked={subscribed}
        onChange={() => void toggle()}
        disabled={busy}
        size="sm"
        label={subscribed ? m.watching : m.watch}
      />
      <span className={`typo-caption ${subscribed ? 'text-status-success' : 'text-foreground/60'}`}>
        {subscribed ? m.watching : m.watch}
      </span>
    </div>
  );
}

/** Ghost icon button that opens the change-history modal for a feed. */
export function HistoryButton({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  return (
    <Tooltip content={t.triggers.marketplace.view_history}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t.triggers.marketplace.view_history}
        onClick={(e) => { e.stopPropagation(); onOpen(); }}
      >
        <History className="w-4 h-4" />
      </Button>
    </Tooltip>
  );
}
