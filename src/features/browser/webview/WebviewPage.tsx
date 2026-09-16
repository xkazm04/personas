/**
 * Browser > Webview — the embedded page host the operator and agents share.
 *
 * THE PAGE IS NOT IN THIS TREE. It is a separate OS window owned by `main`,
 * drawn ABOVE everything React paints and positioned from `PageSlot`'s
 * measurements. Two consequences run through this file:
 *   1. `set_visible(true)` on mount and `set_visible(false)` on unmount —
 *      leaving the route hides the host and KEEPS every tab, because leaving
 *      is not closing anybody's page. A structural test greps for both.
 *   2. No modal opens from here. A `BaseModal` on this route would render
 *      behind the page. Whitelist writes live on the Whitelist route, which
 *      has no page host.
 *
 * See `docs/features/browser.md`.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Globe } from 'lucide-react';

import * as browserApi from '@/api/browser';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveError } from '@/lib/errors/errorRegistry';
import { silentCatch, toastCatch } from '@/lib/silentCatch';

import {
  activeTabOf,
  browserSnapshot,
  initTabs,
  refreshTabs,
  selectTab,
  subscribeBrowser,
} from '../browserStore';
import AddressBar from './AddressBar';
import LeaseBadge from './LeaseBadge';
import PageSlot from './PageSlot';
import PendingApprovalBar from './PendingApprovalBar';
import TabStrip from './TabStrip';

export default function WebviewPage() {
  const { t } = useTranslation();
  const v = t.browser.webview;
  const state = useSyncExternalStore(subscribeBrowser, browserSnapshot);
  const tab = activeTabOf(state);

  const [address, setAddress] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);

  // The host window follows the route: shown while this page is mounted,
  // hidden the moment it is not. Both calls are load-bearing.
  useEffect(() => {
    void initTabs();
    browserApi.setVisible(true).catch(silentCatch('browser show host'));
    return () => {
      browserApi.setVisible(false).catch(silentCatch('browser hide host'));
    };
  }, []);

  // Follow the focused tab's real url — Rust is authoritative about where a
  // page actually went, and a redirect must not leave a stale address up.
  useEffect(() => {
    setAddress(tab?.url ?? '');
    setRefusal(null);
  }, [tab?.id, tab?.url]);

  const navigate = useCallback(async () => {
    const target = address.trim();
    if (!target) return;
    try {
      if (tab) await browserApi.navigateTab(tab.id, target);
      else selectTab(await browserApi.openTab(target));
      setRefusal(null);
    } catch (err) {
      // Inline, not a toast: leaving the whitelist is an ordinary event and a
      // toast per refusal is a storm. The registry owns the copy; the `kind`
      // decides nothing here beyond "this was a refusal we can explain".
      setRefusal(resolveError(err instanceof Error ? err.message : String(err)).message);
    } finally {
      void refreshTabs();
    }
  }, [address, tab]);

  const step = useCallback(
    (direction: 'back' | 'forward') => {
      if (!tab) return;
      const call = direction === 'back' ? browserApi.tabBack : browserApi.tabForward;
      call(tab.id).catch(silentCatch(`browser ${direction}`)).finally(() => void refreshTabs());
    },
    [tab],
  );

  const closeTab = useCallback((id: number) => {
    browserApi
      .closeTab(id)
      .catch(toastCatch('browser close tab', v.close_failed))
      .finally(() => void refreshTabs());
  }, [v.close_failed]);

  const focusTab = useCallback((id: number) => {
    selectTab(id);
    browserApi.focusTab(id).catch(silentCatch('browser focus tab'));
  }, []);

  const revoke = useCallback(async () => {
    if (!tab) return;
    try {
      await browserApi.revokeLease(tab.id);
    } catch (err) {
      toastCatch('browser revoke lease', v.revoke_failed)(err);
    } finally {
      void refreshTabs();
    }
  }, [tab, v.revoke_failed]);

  return (
    <ContentBox data-testid="webview-page">
      <ContentHeader
        icon={<Globe className="w-4 h-4 text-sky-400" />}
        iconColor="sky"
        title={v.title}
        subtitle={v.subtitle}
        toolbar={
          <div className="flex items-center gap-2 flex-wrap w-full min-w-0">
            <div className="flex-1 min-w-[280px]">
              <AddressBar
                tab={tab}
                value={address}
                refusal={refusal}
                onChange={(next) => {
                  setAddress(next);
                  setRefusal(null);
                }}
                onSubmit={() => void navigate()}
                onBack={() => step('back')}
                onForward={() => step('forward')}
              />
            </div>
            <LeaseBadge lease={tab?.lease ?? null} onRevoke={revoke} />
          </div>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col gap-2 px-4 md:px-6 xl:px-8 py-3">
        <TabStrip
          tabs={state.tabs}
          activeTabId={state.activeTabId}
          onSelect={focusTab}
          onClose={closeTab}
        />
        <PendingApprovalBar tabId={state.activeTabId} />
        {state.tabs.length === 0 && !state.tabsLoading ? (
          <EmptyState icon={Globe} title={v.empty_title} description={v.empty_description} />
        ) : null}
        <PageSlot hasTab={state.tabs.length > 0} />
      </div>
    </ContentBox>
  );
}
