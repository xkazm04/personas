/**
 * Browser > Server control (route id `whitelist`, kept so the router and every
 * persisted route stay valid). Two sections on one full-bleed column:
 *
 *   1. App servers: one dev server per project, with a prototype switcher
 *      (`servers/ServerSection.tsx`).
 *   2. Allowed websites: the whitelist ledger, the origin gate every browser
 *      backend consults (`WhitelistLedger.tsx`).
 *
 * The page owns the whitelist data and the two modals that open from its
 * header and the ledger head; `useWhitelistActions` owns the whitelist writes.
 * See `docs/features/browser.md`.
 *
 * MODALS ARE OPENED FROM HERE, NOT FROM THE WEBVIEW. The embedded page is a
 * separate OS window drawn ABOVE the React tree, so a modal on the Webview
 * route would render behind the page. This route has no page host, so a modal
 * here is safe.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Plus, Server } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { KitHost, Section, Surface } from '@/features/shared/components/kit';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';

import { browserSnapshot, putSite, refreshSites, subscribeBrowser } from '../browserStore';
import type { BrowserSite } from '../types';
import AddAppModal from '../servers/AddAppModal';
import ServerSection from '../servers/ServerSection';
import AddSiteModal, { type AddSiteSubmit } from './AddSiteModal';
import { applySiteWrites } from './siteEdit';
import { useWhitelistActions } from './useWhitelistActions';
import WhitelistLedger from './WhitelistLedger';

export default function WhitelistPage() {
  const { t } = useTranslation();
  const w = t.browser.whitelist;
  const s = t.browser.servers;
  const state = useSyncExternalStore(subscribeBrowser, browserSnapshot);
  const actions = useWhitelistActions();

  const [addAppOpen, setAddAppOpen] = useState(false);
  const [editing, setEditing] = useState<BrowserSite | null>(null);
  const [siteModalOpen, setSiteModalOpen] = useState(false);

  useEffect(() => {
    void refreshSites();
  }, []);

  const openAddApp = useCallback(() => setAddAppOpen(true), []);
  const closeSiteModal = useCallback(() => {
    setSiteModalOpen(false);
    setEditing(null);
  }, []);
  const onEdit = useCallback((site: BrowserSite) => {
    setEditing(site);
    setSiteModalOpen(true);
  }, []);

  const onSubmit = useCallback(
    async (value: AddSiteSubmit) => {
      try {
        if (value.mode === 'edit') {
          const row = await applySiteWrites(value.site.origin, value.writes);
          if (row) putSite(row);
          closeSiteModal();
          return;
        }
        const row = await actions.upsert({
          origin: value.origin,
          label: value.label || null,
          enabled: null,
          budget: null,
          created_by: null,
        });
        closeSiteModal();
        if (value.scanNow) void actions.onScan(row);
      } catch (err) {
        // A partly applied edit leaves the row half-written: re-read it so the
        // ledger shows what Rust actually stored.
        if (value.mode === 'edit') void refreshSites();
        toastCatch('browser save site', w.save_failed)(err);
      }
    },
    [actions, closeSiteModal, w.save_failed],
  );

  return (
    <ContentBox data-testid="server-control-page">
      <ContentHeader
        icon={<Server className="w-4 h-4 text-primary" />}
        iconColor="primary"
        fitWidth
        title={s.title}
        subtitle={s.subtitle}
        toolbar={
          <Button
            size="sm"
            variant="primary"
            icon={<Plus className="w-4 h-4" />}
            onClick={openAddApp}
            data-testid="server-add-app"
          >
            {s.add_app}
          </Button>
        }
      />
      <ContentBody flex>
        <div className="flex-1 min-h-0 px-3 md:px-4 xl:px-5 py-5">
          <KitHost>
            <Surface>
              <ServerSection onAdd={openAddApp} />
              <div data-testid="whitelist-section">
                <Section
                  title={s.section_whitelist}
                  count={state.sitesLoaded ? state.sites.length : undefined}
                  desc={w.subtitle}
                  actions={
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<Plus className="w-4 h-4" />}
                      onClick={() => {
                        setEditing(null);
                        setSiteModalOpen(true);
                      }}
                      data-testid="whitelist-add-site"
                    >
                      {w.add_site}
                    </Button>
                  }
                >
                  <div className="k-in">
                    <WhitelistLedger
                      sites={state.sites}
                      loading={state.sitesLoading && !state.sitesLoaded}
                      onToggle={actions.onToggle}
                      onScan={actions.onScan}
                      onConfirm={actions.onConfirm}
                      onRemove={actions.onRemove}
                      onOpen={actions.onOpen}
                      onEdit={onEdit}
                    />
                  </div>
                </Section>
              </div>
            </Surface>
          </KitHost>
        </div>
      </ContentBody>
      <AddAppModal isOpen={addAppOpen} onClose={() => setAddAppOpen(false)} />
      <AddSiteModal isOpen={siteModalOpen} editing={editing} onClose={closeSiteModal} onSubmit={onSubmit} />
    </ContentBox>
  );
}
