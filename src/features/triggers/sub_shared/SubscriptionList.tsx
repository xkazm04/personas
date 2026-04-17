import { Rss, Trash2, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { SharedEventSubscription } from '@/lib/bindings/SharedEventSubscription';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';

interface Props {
  subscriptions: SharedEventSubscription[];
  catalog: SharedEventCatalogEntry[];
  onUnsubscribe: (subscriptionId: string) => void;
}

export function SubscriptionList({ subscriptions, catalog, onUnsubscribe }: Props) {
  const { t } = useTranslation();
  const catalogMap = new Map(catalog.map(c => [c.id, c]));

  if (subscriptions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-center">
        <Rss className="w-8 h-8 text-foreground" />
        <p className="text-sm text-foreground">{t.triggers.subscription_list.no_active_subs}</p>
        <p className="text-xs text-foreground">
          {t.triggers.subscription_list.browse_marketplace}
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-background/95 backdrop-blur">
          <tr className="border-b border-primary/5 text-foreground">
            <th className="text-left px-4 py-2 font-medium">{t.triggers.subscription_list.col_feed}</th>
            <th className="text-left px-4 py-2 font-medium">{t.triggers.subscription_list.col_event_type}</th>
            <th className="text-right px-4 py-2 font-medium">{t.triggers.subscription_list.col_events}</th>
            <th className="text-left px-4 py-2 font-medium">{t.triggers.subscription_list.col_last_event}</th>
            <th className="text-left px-4 py-2 font-medium">{t.triggers.subscription_list.col_status}</th>
            <th className="text-right px-4 py-2 font-medium">{t.triggers.subscription_list.col_actions}</th>
          </tr>
        </thead>
        <tbody>
          {subscriptions.map(sub => {
            const entry = catalogMap.get(sub.catalogEntryId);
            return (
              <tr key={sub.id} className="border-b border-primary/5 hover:bg-secondary/30 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{entry?.icon ?? '📡'}</span>
                    <span className="font-medium text-foreground">{entry?.name ?? sub.slug}</span>
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <code className="text-[10px] px-1.5 py-0.5 rounded bg-secondary/60 text-foreground">
                    shared:{sub.slug}
                  </code>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {sub.eventsRelayed}
                </td>
                <td className="px-4 py-2.5 text-foreground">
                  {sub.lastEventAt
                    ? new Date(sub.lastEventAt).toLocaleString()
                    : t.triggers.subscription_list.never
                  }
                </td>
                <td className="px-4 py-2.5">
                  {sub.error ? (
                    <span className="flex items-center gap-1 text-red-400">
                      <AlertCircle className="w-3 h-3" />
                      {t.triggers.subscription_list.error}
                    </span>
                  ) : (
                    <span className="text-emerald-400">{t.triggers.subscription_list.active}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={() => onUnsubscribe(sub.id)}
                    className="p-1 rounded hover:bg-red-500/10 text-foreground hover:text-red-400 transition-colors"
                    title={t.triggers.subscription_list.unsubscribe}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
