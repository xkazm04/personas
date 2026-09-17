/**
 * Browser > Whitelist — the origin gate every browser backend consults.
 *
 * The page owns the data and the layout; `useWhitelistActions` owns the writes
 * and the three variants own only the presentation. That split is what makes
 * the switcher honest: every variant gets the identical `WhitelistVariantProps`
 * and cannot quietly become a fourth product. See `docs/features/browser.md`.
 *
 * MODALS ARE OPENED FROM HERE, NOT FROM THE WEBVIEW. The embedded page is a
 * separate OS window drawn ABOVE the React tree, so a modal on the Webview
 * route would render behind the page. This route has no page host, so a modal
 * here is safe.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Plus, ShieldCheck } from 'lucide-react';

import Button from '@/features/shared/components/buttons/Button';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { ContentBody, ContentBox, ContentHeader } from '@/features/shared/components/layout/ContentLayout';
import { useTranslation } from '@/i18n/useTranslation';
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';
import { toastCatch } from '@/lib/silentCatch';

import { browserSnapshot, refreshSites, subscribeBrowser } from '../browserStore';
import type { BrowserSite } from '../types';
import AddSiteModal, { type AddSiteSubmit } from './AddSiteModal';
import { useWhitelistActions } from './useWhitelistActions';
import CardsVariant from './variants/CardsVariant';
import LedgerVariant from './variants/LedgerVariant';
import MasterDetailVariant from './variants/MasterDetailVariant';
import {
  WHITELIST_VARIANT_IDS,
  type WhitelistVariant,
  type WhitelistVariantId,
} from './variants/variantProps';

const VARIANT_KEY = 'personas.browser.whitelist.variant';

/** Shared by the tab strip and the panel it controls, so the ids line up. */
const VARIANT_TABS_PREFIX = 'whitelist-variant';

const VARIANTS: Record<WhitelistVariantId, WhitelistVariant> = {
  ledger: LedgerVariant,
  cards: CardsVariant,
  detail: MasterDetailVariant,
};

function readVariant(): WhitelistVariantId {
  const raw = safeLocalGet(VARIANT_KEY, 'whitelist variant read');
  return WHITELIST_VARIANT_IDS.includes(raw as WhitelistVariantId)
    ? (raw as WhitelistVariantId)
    : 'ledger';
}

export default function WhitelistPage() {
  const { t } = useTranslation();
  const w = t.browser.whitelist;
  const state = useSyncExternalStore(subscribeBrowser, browserSnapshot);
  const actions = useWhitelistActions();

  const [variant, setVariant] = useState<WhitelistVariantId>(readVariant);
  const [editing, setEditing] = useState<BrowserSite | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  useEffect(() => {
    void refreshSites();
  }, []);

  const chooseVariant = useCallback((id: WhitelistVariantId) => {
    setVariant(id);
    safeLocalSet(VARIANT_KEY, id, 'whitelist variant write');
  }, []);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    setEditing(null);
  }, []);

  const onEdit = useCallback((site: BrowserSite) => {
    setEditing(site);
    setModalOpen(true);
  }, []);

  const onSubmit = useCallback(
    async ({ origin, label, scanNow }: AddSiteSubmit) => {
      try {
        const row = await actions.upsert({
          origin,
          label: label || null,
          enabled: null,
          budget: null,
          created_by: null,
        });
        closeModal();
        if (scanNow) void actions.onScan(row);
      } catch (err) {
        toastCatch('browser upsert site', w.save_failed)(err);
      }
    },
    [actions, closeModal, w.save_failed],
  );

  const Variant = VARIANTS[variant];
  const variantTabs = useMemo(
    () => [
      { id: 'ledger' as const, label: w.variant_ledger },
      { id: 'cards' as const, label: w.variant_cards },
      { id: 'detail' as const, label: w.variant_detail },
    ],
    [w.variant_ledger, w.variant_cards, w.variant_detail],
  );

  return (
    <ContentBox data-testid="whitelist-page">
      <ContentHeader
        icon={<ShieldCheck className="w-4 h-4 text-emerald-400" />}
        iconColor="emerald"
        title={w.title}
        subtitle={w.subtitle}
        toolbar={
          <div className="flex items-center gap-2 flex-wrap w-full">
            <Button
              size="sm"
              variant="primary"
              icon={<Plus className="w-4 h-4" />}
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
              data-testid="whitelist-add-site"
            >
              {w.add_site}
            </Button>
            <div className="ml-auto">
              <SegmentedTabs<WhitelistVariantId>
                tabs={variantTabs}
                activeTab={variant}
                onTabChange={chooseVariant}
                ariaLabel={w.variant_label}
                idPrefix={VARIANT_TABS_PREFIX}
                size="sm"
              />
            </div>
          </div>
        }
      />
      <ContentBody>
        {/* `segmentedTabPanelProps` supplies the id SegmentedTabs' own
            `aria-controls` points at. `role="tabpanel"` is redundant with that
            spread and written out anyway: the helper hides it behind a call,
            where neither a reader nor the census rule that checks tab strips
            declare a panel can see it. Same value, nothing changes at runtime. */}
        <div
          {...segmentedTabPanelProps(VARIANT_TABS_PREFIX, variant)}
          role="tabpanel"
          data-testid={`whitelist-variant-${variant}`}
        >
          <Variant
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
      </ContentBody>
      <AddSiteModal isOpen={modalOpen} editing={editing} onClose={closeModal} onSubmit={onSubmit} />
    </ContentBox>
  );
}
