/**
 * Browser > Server control: the app-server section above the whitelist ledger.
 *
 * The section owns the data (`devServerStore`), the right-click menu
 * (`useServerMenu`) and the Edit modal; the four prototype variants own only
 * presentation and all receive the identical `ServerVariantProps`. Add app is
 * the page's (its header carries the primary button), so it arrives as `onAdd`.
 *
 * Two states never reach a variant: a first list that FAILED renders an error
 * with retry (a failure must not look like "no servers"), and a list that
 * loaded EMPTY renders the empty state with Add app.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Server } from 'lucide-react';

import * as api from '@/api/devServers';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Section } from '@/features/shared/components/kit';
import { SegmentedTabs, segmentedTabPanelProps } from '@/features/shared/components/layout/SegmentedTabs';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import { safeLocalGet, safeLocalSet } from '@/lib/safeLocalStorage';
import { toastCatch } from '@/lib/silentCatch';

import EditServerModal from './EditServerModal';
import { ensureDevServers, refreshDevServers, serverAction, useDevServers } from './devServerStore';
import { canStart, canStop, readHostPort } from './serverTone';
import { SERVER_VARIANT_IDS, type ServerVariant, type ServerVariantId } from './serverVariantProps';
import { useServerMenu } from './useServerMenu';
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

export default function ServerSection({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  const s = t.browser.servers;
  const snapshot = useDevServers();
  const [variant, setVariant] = useState<ServerVariantId>(readVariant);
  const [editing, setEditing] = useState<DevServerView | null>(null);
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

  const onRescan = useCallback(
    (server: DevServerView) => {
      api.rescanDevServer(server.projectId).catch(toastCatch('dev server rescan', s.rescan_failed));
    },
    [s.rescan_failed],
  );
  const onRemove = useCallback(
    (server: DevServerView) => {
      api.removeDevServer(server.projectId).catch(toastCatch('dev server remove', s.remove_failed));
    },
    [s.remove_failed],
  );
  const { onMenu, menu } = useServerMenu({
    byProject: snapshot.byProject,
    hostPort,
    onEdit: setEditing,
    onRescan,
    onRemove,
  });

  const variantTabs = useMemo(() => SERVER_VARIANT_IDS.map((id) => ({ id, label: s[`variant_${id}`] })), [s]);
  const Variant = VARIANTS[variant];
  const { servers, loaded, error } = snapshot;
  const failedEmpty = error !== null && servers.length === 0;
  const empty = loaded && !failedEmpty && servers.length === 0;

  return (
    <div data-testid="server-section">
      <Section
        title={s.section_servers}
        count={loaded ? servers.length : undefined}
        actions={
          // No servers, no layouts to choose between: the switcher would only
          // repeat the empty state. nowrap: the head's action slot shrinks to
          // min-content, which broke "Port map" and "Live tiles" onto two lines.
          !empty &&
          !failedEmpty && (
            <div className="whitespace-nowrap">
              <SegmentedTabs<ServerVariantId>
                tabs={variantTabs}
                activeTab={variant}
                onTabChange={chooseVariant}
                ariaLabel={s.variant_label}
                idPrefix={VARIANT_TABS_PREFIX}
                size="sm"
              />
            </div>
          )
        }
      >
        <div className="k-in flex flex-col gap-3">
          {error !== null && (
            <ErrorBanner
              variant={failedEmpty ? 'panel' : 'inline'}
              message={`${s.list_failed}. ${resolveErrorTranslated(t, error).message}`}
              onRetry={() => void refreshDevServers()}
            />
          )}
          {empty ? (
            <EmptyState
              icon={Server}
              title={s.empty_title}
              subtitle={s.empty_description}
              action={{ label: s.add_app, onClick: onAdd, icon: Plus }}
            />
          ) : failedEmpty ? null : (
            <div
              {...segmentedTabPanelProps(VARIANT_TABS_PREFIX, variant)}
              role="tabpanel"
              data-testid={`server-variant-${variant}`}
            >
              <Variant
                servers={servers}
                loading={snapshot.loading && !loaded}
                hostPort={hostPort}
                onMenu={onMenu}
                onToggle={onToggle}
                onAdd={onAdd}
              />
            </div>
          )}
        </div>
      </Section>
      {menu}
      <EditServerModal server={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
