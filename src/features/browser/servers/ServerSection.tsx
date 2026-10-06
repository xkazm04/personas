/**
 * Browser > Server control: the app-server section above the whitelist ledger.
 *
 * The section owns the data (`devServerStore`), the right-click menu
 * (`useServerMenu`) and the Edit modal; the tiles (`ServerTiles`) own only
 * presentation. Add app is the page's (its header carries the primary
 * button), so it arrives as `onAdd`.
 *
 * Two states never reach the tiles: a first list that FAILED renders an error
 * with retry (a failure must not look like "no servers"), and a list that
 * loaded EMPTY renders the empty state with Add app.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Server } from 'lucide-react';

import * as api from '@/api/devServers';
import { ErrorBanner } from '@/features/shared/components/feedback/ErrorBanner';
import EmptyState from '@/features/shared/components/feedback/ScenarioEmptyState';
import { Section } from '@/features/shared/components/kit';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import type { DevServerView } from '@/lib/bindings/DevServerView';
import { toastCatch } from '@/lib/silentCatch';

import EditServerModal from './EditServerModal';
import { ensureDevServers, refreshDevServers, serverAction, useDevServers } from './devServerStore';
import { canStart, canStop, readHostPort } from './serverTone';
import { useServerMenu } from './useServerMenu';
import ServerTiles from './ServerTiles';

export default function ServerSection({ onAdd }: { onAdd: () => void }) {
  const { t } = useTranslation();
  const s = t.browser.servers;
  const snapshot = useDevServers();
  const [editing, setEditing] = useState<DevServerView | null>(null);
  const hostPort = useMemo(readHostPort, []);

  useEffect(() => {
    void ensureDevServers();
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

  const { servers, loaded, error } = snapshot;
  const failedEmpty = error !== null && servers.length === 0;
  const empty = loaded && !failedEmpty && servers.length === 0;

  return (
    <div data-testid="server-section">
      <Section
        title={s.section_servers}
        count={loaded ? servers.length : undefined}
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
            <ServerTiles
              servers={servers}
              loading={snapshot.loading && !loaded}
              hostPort={hostPort}
              onMenu={onMenu}
              onToggle={onToggle}
              onAdd={onAdd}
            />
          )}
        </div>
      </Section>
      {menu}
      <EditServerModal server={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
