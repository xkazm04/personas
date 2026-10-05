/**
 * Browser > Server control: the app-server section above the whitelist ledger.
 *
 * The section owns the data (`devServerStore`), the right-click menu and the
 * modals; the four prototype variants own only presentation and all receive
 * the identical `ServerVariantProps`. WP0 SHELL: the menu and modals land in
 * WP2 (spark `server-control`).
 */
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react';

import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';

import { ensureDevServers, serverAction, useDevServers } from './devServerStore';
import { canStart, canStop, readHostPort } from './serverTone';
import { SERVER_VARIANT_IDS, type ServerVariant, type ServerVariantId } from './serverVariantProps';
import LiveTilesVariant from './variants/LiveTilesVariant';
import PortMapVariant from './variants/PortMapVariant';
import RackVariant from './variants/RackVariant';
import SwitchboardVariant from './variants/SwitchboardVariant';

const VARIANT_KEY = 'personas.browser.servers.variant';
/** Shared by the tab strip and the panel it controls, so the ids line up. */
const VARIANT_TABS_PREFIX = 'server-variant';

const VARIANTS: Record<ServerVariantId, ServerVariant> = {
  rack: RackVariant,
  portmap: PortMapVariant,
  switchboard: SwitchboardVariant,
  tiles: LiveTilesVariant,
};

function readVariant(): ServerVariantId {
  const raw = safeLocalGet(VARIANT_KEY, 'server variant read');
  return SERVER_VARIANT_IDS.includes(raw as ServerVariantId) ? (raw as ServerVariantId) : 'rack';
}

export default function ServerSection() {
  const { t } = useTranslation();
  const s = t.browser.servers;
  const snapshot = useDevServers();
  const [variant, setVariant] = useState<ServerVariantId>(readVariant);
  const hostPort = useMemo(readHostPort, []);

  useEffect(() => {
    void ensureDevServers();
  }, []);

  const chooseVariant = useCallback((id: ServerVariantId) => {
    setVariant(id);
    safeLocalSet(VARIANT_KEY, id, 'server variant write');
  }, []);

  const onToggle = useCallback(
    (server: DevServerView) => {
      if (server.devPort === hostPort) return;
      if (canStop(server.state)) void serverAction('stop', server.projectId);
      else if (canStart(server.state)) void serverAction('start', server.projectId);
    },
    [hostPort],
  );
  const onMenu = useCallback((e: MouseEvent) => {
    e.preventDefault();
  }, []);
  const onAdd = useCallback(() => {}, []);

  const variantTabs = useMemo(
    () => SERVER_VARIANT_IDS.map((id) => ({ id, label: s[`variant_${id}`] })),
    [s],
  );
  const Variant = VARIANTS[variant];

  return (
    <section className="flex flex-col gap-3" data-testid="server-section" aria-label={s.section_servers}>
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="typo-section-title">{s.section_servers}</h2>
        <div className="ml-auto">
          <SegmentedTabs<ServerVariantId>
            tabs={variantTabs}
            activeTab={variant}
            onTabChange={chooseVariant}
            ariaLabel={s.variant_label}
            idPrefix={VARIANT_TABS_PREFIX}
            size="sm"
          />
        </div>
      </div>
      <div
        {...segmentedTabPanelProps(VARIANT_TABS_PREFIX, variant)}
        role="tabpanel"
        data-testid={`server-variant-${variant}`}
      >
        <Variant
          servers={snapshot.servers}
          loading={snapshot.loading && !snapshot.loaded}
          hostPort={hostPort}
          onMenu={onMenu}
          onToggle={onToggle}
          onAdd={onAdd}
        />
      </div>
    </section>
  );
}
