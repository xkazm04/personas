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
import { useSystemStore } from '@/stores/systemStore';

import {
  activeTabOf,
  browserSnapshot,
  initTabs,
  refreshSites,
  refreshTabs,
  selectTab,
  subscribeBrowser,
} from '../browserStore';
import * as twinLane from '../twinDraftLane';
import AddressBar from './AddressBar';
import LeaseBadge from './LeaseBadge';
import PageSlot from './PageSlot';
import PendingApprovalBar from './PendingApprovalBar';
import TabStrip from './TabStrip';
import TwinStatusRow from './TwinStatusRow';
import TwinSteerRow from './TwinSteerRow';
import TwinToolbar from './TwinToolbar';

export default function WebviewPage() {
  const { t } = useTranslation();
  const v = t.browser.webview;
  const state = useSyncExternalStore(subscribeBrowser, browserSnapshot);
  const tab = activeTabOf(state);

  // The Twin lane: gated on the plugin, and its Draft icon on an active twin.
  // `fetchTwinProfiles` is deduped in the slice, so calling it on every mount
  // is one fetch at most per freshness window.
  const twinEnabled = useSystemStore((s) => s.enabledPlugins.has('twin'));
  const activeTwinId = useSystemStore((s) => s.activeTwinId);
  const fetchTwinProfiles = useSystemStore((s) => s.fetchTwinProfiles);
  const lane = useSyncExternalStore(twinLane.subscribeTwinDraft, twinLane.twinDraftSnapshot);
  useEffect(() => {
    if (twinEnabled) void fetchTwinProfiles();
  }, [twinEnabled, fetchTwinProfiles]);

  const armTwin = useCallback(() => {
    if (!tab || !activeTwinId) return;
    void twinLane.arm(tab.id, activeTwinId);
  }, [tab, activeTwinId]);

  const cancelTwin = useCallback(() => {
    if (lane.tabId === null) return;
    void twinLane.cancel(lane.tabId);
  }, [lane.tabId]);

  const regenerateTwin = useCallback(async () => {
    if (!activeTwinId) return;
    await twinLane.regenerate(activeTwinId);
  }, [activeTwinId]);

  const confirmTwinSubmit = useCallback(async () => {
    if (lane.tabId === null) return;
    await twinLane.confirmSubmit(lane.tabId);
    void refreshTabs();
  }, [lane.tabId]);

  const [address, setAddress] = useState('');
  const [refusal, setRefusal] = useState<string | null>(null);
  const [suggestOpen, setSuggestOpen] = useState(false);

  // The host window follows the route: shown while this page is mounted,
  // hidden the moment it is not. Both calls are load-bearing.
  useEffect(() => {
    void initTabs();
    void refreshSites();
    browserApi.setVisible(true).catch(silentCatch('browser show host'));
    return () => {
      browserApi.setVisible(false).catch(silentCatch('browser hide host'));
    };
  }, []);

  // THE ADDRESS-BAR POPUP HIDES THE PAGE. The page host is a separate OS window
  // painted above the whole React tree, so a suggestion list hanging off the
  // address bar is invisible the moment it crosses the slot's top edge — and it
  // always does, because the slot starts a few dozen pixels below the field.
  // There is no z-index that wins this, so the host steps aside while the popup
  // is open and comes back when it closes. The tabs are untouched: hiding is not
  // closing, and the page is exactly where it was.
  useEffect(() => {
    browserApi
      .setVisible(!suggestOpen)
      .catch(silentCatch(suggestOpen ? 'browser hide host' : 'browser show host'));
  }, [suggestOpen]);

  // Follow the focused tab's real url — Rust is authoritative about where a
  // page actually went, and a redirect must not leave a stale address up.
  useEffect(() => {
    setAddress(tab?.url ?? '');
    setRefusal(null);
  }, [tab?.id, tab?.url]);

  const navigate = useCallback(async (override?: string) => {
    const target = (override ?? address).trim();
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

  // Picking a suggestion is ONE act: the field takes the origin and the tab goes
  // there. Passing it explicitly rather than through `setAddress` avoids reading
  // a state value the same tick that set it.
  const goTo = useCallback(
    (origin: string) => {
      setAddress(origin);
      setRefusal(null);
      void navigate(origin);
    },
    [navigate],
  );

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
          <div className="w-full min-w-0 flex flex-col gap-1.5">
            {/* One row, never wrapping: the address field yields (down to a
                200px floor) before the Twin icons or the lease badge move. */}
            <div className="flex items-center gap-2 flex-nowrap w-full min-w-0">
              <div className="flex-1 min-w-[200px]">
                <AddressBar
                  tab={tab}
                  value={address}
                  refusal={refusal}
                  sites={state.sites}
                  onSelectSuggestion={goTo}
                  onSuggestionsOpenChange={setSuggestOpen}
                  onChange={(next) => {
                    setAddress(next);
                    setRefusal(null);
                  }}
                  onSubmit={() => void navigate()}
                  onBack={() => step('back')}
                  onForward={() => step('forward')}
                />
              </div>
              {twinEnabled ? (
                <TwinToolbar
                  phase={lane.phase}
                  activeTwinId={activeTwinId}
                  hasTab={tab !== null}
                  onArm={armTwin}
                  onCancel={cancelTwin}
                  onSubmit={twinLane.requestSubmit}
                />
              ) : null}
              <div className="shrink-0 flex items-center gap-2">
                <LeaseBadge lease={tab?.lease ?? null} onRevoke={revoke} />
              </div>
            </div>
            {/* Thin tab line right under the address field — header chrome,
                so the page slot below starts where the page actually starts. */}
            <TabStrip
              tabs={state.tabs}
              activeTabId={state.activeTabId}
              onSelect={focusTab}
              onClose={closeTab}
            />
          </div>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col gap-2 px-4 md:px-6 xl:px-8 py-3">
        {/* INLINE rows, never an overlay: the page host is a separate OS window
            and `PageSlot` re-measures when these rows push it down. */}
        {twinEnabled ? (
          <>
            <TwinStatusRow
              lane={lane}
              onConfirmSubmit={confirmTwinSubmit}
              onDismissSubmit={twinLane.dismissSubmit}
            />
            <TwinSteerRow
              lane={lane}
              onSteer={twinLane.setSteer}
              onDirections={twinLane.setDirections}
              onRegenerate={regenerateTwin}
            />
          </>
        ) : null}
        <PendingApprovalBar tabId={state.activeTabId} />
        {state.tabs.length === 0 && !state.tabsLoading ? (
          <EmptyState icon={Globe} title={v.empty_title} description={v.empty_description} />
        ) : null}
        <PageSlot hasTab={state.tabs.length > 0} />
      </div>
    </ContentBox>
  );
}
