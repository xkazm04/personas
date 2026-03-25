import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Store, Search, X, Rss, RssIcon } from 'lucide-react';
import * as api from '@/api/events/sharedEvents';
import type { SharedEventCatalogEntry } from '@/lib/bindings/SharedEventCatalogEntry';
import type { SharedEventSubscription } from '@/lib/bindings/SharedEventSubscription';
import { CatalogCard } from './CatalogCard';
import { SubscriptionList } from './SubscriptionList';

type View = 'browse' | 'subscriptions';

export function SharedEventsTab() {
  const [view, setView] = useState<View>('browse');
  const [catalog, setCatalog] = useState<SharedEventCatalogEntry[]>([]);
  const [subscriptions, setSubscriptions] = useState<SharedEventSubscription[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cat, subs] = await Promise.all([
        api.browseCatalog(category || undefined, search || undefined),
        api.listSubscriptions(),
      ]);
      setCatalog(cat);
      setSubscriptions(subs);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [category, search]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => {
    setLoading(true);
    try {
      const entries = await api.refreshCatalog();
      setCatalog(entries);
      setSubscriptions(await api.listSubscriptions());
    } catch {
      // cloud unavailable
    } finally {
      setLoading(false);
    }
  };

  const subscribedIds = new Set(subscriptions.map(s => s.catalogEntryId));

  const handleSubscribe = async (entryId: string) => {
    try {
      const sub = await api.subscribeFeed(entryId);
      setSubscriptions(prev => [sub, ...prev]);
    } catch (e) {
      console.error('Subscribe failed:', e);
    }
  };

  const handleUnsubscribe = async (subId: string) => {
    try {
      await api.unsubscribeFeed(subId);
      setSubscriptions(prev => prev.filter(s => s.id !== subId));
    } catch (e) {
      console.error('Unsubscribe failed:', e);
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
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'browse' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Store className="w-3 h-3 inline mr-1.5" />
            Browse
          </button>
          <button
            onClick={() => setView('subscriptions')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === 'subscriptions' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
            }`}
          >
            <Rss className="w-3 h-3 inline mr-1.5" />
            My Subscriptions
            {subscriptions.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/15 text-[10px]">{subscriptions.length}</span>
            )}
          </button>
        </div>

        <button
          onClick={refresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Content */}
      {view === 'browse' ? (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Filters */}
          <div className="flex items-center gap-2 px-4 py-2">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search feeds..."
                className="w-full pl-8 pr-7 py-1.5 text-xs rounded-md bg-secondary/50 border border-primary/10 text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30"
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="w-3 h-3 text-muted-foreground/50 hover:text-foreground" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 overflow-x-auto">
              <button
                onClick={() => setCategory('')}
                className={`px-2.5 py-1 text-[11px] rounded-full whitespace-nowrap transition-colors ${
                  !category ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50'
                }`}
              >
                All
              </button>
              {categories.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`px-2.5 py-1 text-[11px] rounded-full whitespace-nowrap capitalize transition-colors ${
                    category === cat ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/50'
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
                      if (sub) handleUnsubscribe(sub.id);
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-3 py-16 text-center">
                <div className="w-12 h-12 rounded-xl bg-sky-500/10 flex items-center justify-center">
                  <RssIcon className="w-6 h-6 text-sky-400" />
                </div>
                <p className="text-sm text-muted-foreground">
                  {loading ? 'Loading catalog...' : 'No shared event feeds available yet'}
                </p>
                <p className="text-xs text-muted-foreground/50">
                  Click Refresh to fetch the latest feeds from the cloud
                </p>
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
