/**
 * Every write the Whitelist page can perform, in one place.
 *
 * Extracted from `WhitelistPage` so the page is data + layout and this is the
 * gate's mutation surface: each action calls one command, adopts the row the
 * command answers with (no refetch round-trip), and resolves its own failure
 * copy. The three variants never call an API — they receive these.
 *
 * SCAN AND CONFIRM RE-READ REGARDLESS OF OUTCOME. The row, not the call's
 * return value, carries `scan_status` / `scan_report` / `scan_tier`, so a
 * refusal is as informative as a success and both are followed by a read.
 */
import { useCallback, useMemo } from 'react';

import * as browserApi from '@/api/browser';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { forgetSite, putSite, refreshSites } from '../browserStore';
import type { BrowserSite, UpsertBrowserSiteInput } from '../types';

export interface WhitelistActions {
  onToggle: (site: BrowserSite) => Promise<void>;
  onScan: (site: BrowserSite) => Promise<void>;
  onConfirm: (site: BrowserSite) => Promise<void>;
  onRemove: (site: BrowserSite) => Promise<void>;
  onOpen: (site: BrowserSite) => Promise<void>;
  /** Create-or-rename. Answers with the stored row so the caller can scan it. */
  upsert: (input: UpsertBrowserSiteInput) => Promise<BrowserSite>;
}

export function useWhitelistActions(): WhitelistActions {
  const { t } = useTranslation();
  const w = t.browser.whitelist;
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setTeamsTab = useSystemStore((s) => s.setTeamsTab);

  const onToggle = useCallback(
    async (site: BrowserSite) => {
      try {
        putSite(await browserApi.setSiteEnabled(site.origin, !site.enabled));
      } catch (err) {
        toastCatch('browser toggle site', w.toggle_failed)(err);
      }
    },
    [w.toggle_failed],
  );

  const onScan = useCallback(
    async (site: BrowserSite) => {
      try {
        await browserApi.scanSite(site.origin);
      } catch (err) {
        toastCatch('browser scan site', w.scan_failed_toast)(err);
      } finally {
        void refreshSites();
      }
    },
    [w.scan_failed_toast],
  );

  const onConfirm = useCallback(
    async (site: BrowserSite) => {
      try {
        await browserApi.confirmScan(site.origin);
      } catch (err) {
        toastCatch('browser confirm scan', w.confirm_failed)(err);
      } finally {
        void refreshSites();
      }
    },
    [w.confirm_failed],
  );

  const onRemove = useCallback(
    async (site: BrowserSite) => {
      try {
        if (await browserApi.deleteSite(site.origin)) forgetSite(site.origin);
      } catch (err) {
        toastCatch('browser delete site', w.remove_failed)(err);
      }
    },
    [w.remove_failed],
  );

  const onOpen = useCallback(
    async (site: BrowserSite) => {
      try {
        await browserApi.openTab(site.origin);
        setSidebarSection('teams');
        setTeamsTab('webview');
      } catch (err) {
        toastCatch('browser open site', w.open_failed)(err);
      }
    },
    [setSidebarSection, setTeamsTab, w.open_failed],
  );

  const upsert = useCallback(async (input: UpsertBrowserSiteInput) => {
    const row = await browserApi.upsertSite(input);
    putSite(row);
    return row;
  }, []);

  return useMemo(
    () => ({ onToggle, onScan, onConfirm, onRemove, onOpen, upsert }),
    [onToggle, onScan, onConfirm, onRemove, onOpen, upsert],
  );
}
