import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Store, Search, X, Rss, RssIcon, LayoutGrid, Table2, RadioTower } from 'lucide-react';
import * as api from '@/api/events/sharedEvents';
import { createLogger } from "@/lib/log";
import { useDebounce } from '@/hooks/utility/timing/useDebounce';

const logger = createLogger("shared-events");
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import type { SharedEventSubscription } from '@/lib/bindings/SharedEventSubscription';
import { CatalogCard } from './CatalogCard';
import { SubscriptionList } from './SubscriptionList';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { SharedEventsRegistryVariant } from './SharedEventsRegistryVariant';
import { SharedEventsWatchtowerVariant } from './SharedEventsWatchtowerVariant';


type View = 'browse' | 'subscriptions';

// --- Prototype variant switcher (throwaway scaffold) -----------------------
// A/B the current card grid against two directional TABLE variants without
// forking the call site. Baseline (Cards) stays default so nothing changes on
// load. Consolidation will collapse this to the winning variant.
type MarketplaceVariant = 'cards' | 'registry' | 'watchtower';

export function SharedEventsTab() {
  const { t } = useTranslation();
  const [variant, setVariant] = useState<MarketplaceVariant>('cards');
  const m = t.triggers.marketplace;

  const tabs: { id: MarketplaceVariant; label: string; sub: string; icon: typeof Store }[] = [
    { id: 'cards', label: m.view_cards, sub: m.view_cards_sub, icon: LayoutGrid },
    { id: 'registry', label: m.view_registry, sub: m.view_registry_sub, icon: Table2 },
    { id: 'watchtower', label: m.view_watchtower, sub: m.view_watchtower_sub, icon: RadioTower },
  ];

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-primary/5">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = variant === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setVariant(tab.id)}
              title={tab.sub}
              className={`flex items-center gap-1.5 px-3 py-1.5 typo-caption font-medium rounded-input transition-colors ${
                active ? 'bg-primary/10 text-primary' : 'text-foreground/70 hover:text-foreground hover:bg-secondary/50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div key={variant} className="animate-fade-slide-in flex-1 flex flex-col min-h-0 overflow-hidden">
        {variant === 'cards' && <SharedEventsCardsBaseline />}
        {variant === 'registry' && <SharedEventsRegistryVariant />}
        {variant === 'watchtower' && <SharedEventsWatchtowerVariant />}
      </div>
    </div>
  );
}

function SharedEventsCardsBaseline() {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('browse');
  const [catalog, setCatalog] = useState<SharedEventCatalogEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<SharedEventSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, subs] = await Promise.all([
        api.browseCatalog(category || undefined, debouncedSearch || undefined),
        api.listSubscriptions(),
      ]);
      setCatalog(cat);
      setSubscriptions(subs);
    } catch (err) { silentCatch("features/triggers/sub_shared/SharedEventsTab:catch1")(err); } finally {
      setLoading(false);
    }
  }, [category, debouncedSearch]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setLoading(true);
    try {
      const entries = await api.refreshCatalog();
      setCatalog(entries);
      setSubscriptions(await api.listSubscriptions());
    } catch (err) { silentCatch("features/triggers/sub_shared/SharedEventsTab:catch2")(err); } finally {
      setLoading(false);
    }
  };

  const subscribedIds = new Set(subscriptions.map(s => s.catalogEntryId));

  const handleSubscribe = async (entryId: string) => {
    try {
      const sub = await api.subscribeFeed(entryId);
      setSubscriptions(prev => [sub, ...prev]);
    } catch (e) {
      logger.error('Subscribe failed', { entryId, error: String(e) });
    }
  };

  const handleUnsubscribe = async (subId: string) => {
    try {
      await api.unsubscribeFeed(subId);
      setSubscriptions(prev => prev.filter(s => s.id !== subId));
    } catch (e) {
      logger.error('Unsubscribe failed', { subId, error: String(e) });
    }
  };

  // Extract unique categories from catalog
  const categories = [...new Set(catalog.map(e => e.category))].sort();

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary/5">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setView('browse')}
            className={`px-3 py-1.5 typo-caption font-medium rounded-input transition-colors ${
              view === 'browse' ? 'bg-primary/10 text-primary' : 'text-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Store className="w-3 h-3 inline mr-1.5" />
            {t.triggers.browse_label}
          </button>
          <button
            onClick={() => setView('subscriptions')}
            className={`px-3 py-1.5 typo-caption font-medium rounded-input transition-colors ${
              view === 'subscriptions' ? 'bg-primary/10 text-primary' : 'text-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Rss className="w-3 h-3 inline mr-1.5" />
            {t.triggers.my_subscriptions}
            {subscriptions.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/15 text-[10px]">{subscriptions.length}</span>
            )}
          </button>
        </div>

        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 typo-caption font-medium rounded-card text-foreground hover:text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          {t.common.refresh}
        </button>
      </div>

      {/* Content */}
      {view === 'browse' ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-foreground" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder={t.triggers.search_feeds}
                className="w-full pl-8 pr-7 py-1.5 typo-caption rounded-input bg-secondary/50 border border-primary/10 text-foreground placeholder:text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="w-3 h-3 text-foreground hover:text-foreground" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              <button
                onClick={() => setCategory('')}
                className={`px-2.5 py-1 text-[11px] rounded-full whitespace-nowrap transition-colors ${
                  !category ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary/50'
                }`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 text-[11px] rounded-full whitespace-nowrap capitalize transition-colors ${
                    category === cat ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary/50'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          {/* Grid */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {catalog.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {catalog.map(entry => (
                  <CatalogCard
                    key={entry.id}
                    entry={entry}
                    isSubscribed={subscribedIds.has(entry.id)}
                    onSubscribe={() => handleSubscribe(entry.id)}
                    onUnsubscribe={() => {
                      const sub = subscriptions.find(s => s.catalogEntryId === entry.id);
                      return sub ? handleUnsubscribe(sub.id) : undefined;
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <EmptyState
                  icon={RssIcon}
                  iconColor="text-sky-400"
                  iconContainerClassName="bg-sky-500/10 border-sky-500/20"
                  title={loading ? t.triggers.loading_catalog : t.triggers.no_feeds}
                  subtitle={t.triggers.no_feeds_hint}
                />
              </div>
            )}
          </div>
        </div>
      ) : (
        <SubscriptionList
          subscriptions={subscriptions}
          catalog={catalog}
          onUnsubscribe={handleUnsubscribe}
        />
      )}
    </div>
  );
}
