import { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, RefreshCw, Trash2, Download } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { checkHooks, installHooks, uninstallHooks } from '@/api/fleet/fleet';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';
import { FleetMobilePreview } from '../FleetMobilePreview';
import { FleetPairDevice } from '../FleetPairDevice';
import { FleetTerminalSettings } from './FleetTerminalSettings';
import { FleetAutoHibernateSettings } from './FleetAutoHibernateSettings';
import { FleetStateCutoffSettings } from './FleetStateCutoffSettings';
import { FleetProcessScanner } from './FleetProcessScanner';
import { FleetHookBanner } from './FleetHookBanner';
import { FleetHookEntries } from './FleetHookEntries';
import { debtText } from '@/i18n/DebtText';


/**
 * Settings sub-tab — diagnostics + uninstall.
 *
 * Install is the common path and lives in the Sessions tab header pill
 * (see FleetHooksPill). This page keeps:
 *  - status banner (loading / installed / port mismatch / missing)
 *  - uninstall + re-install + refresh actions
 *  - per-event presence checklist
 */
export default function FleetSettingsPage() {
  const [status, setStatus] = useState<FleetHookStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const applyStatus = useSystemStore((s) => s.fleetApplyHookStatus);

  const refresh = useCallback(() => {
    checkHooks()
      .then((s) => {
        setStatus(s);
        applyStatus(s);
      })
      .catch(silentCatch('FleetSettingsPage:check'));
  }, [applyStatus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleInstall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await installHooks();
      setStatus(next);
      applyStatus(next);
    } catch (e) {
      toastCatch('FleetSettingsPage:install', 'Failed to install Claude Code hooks')(e);
    } finally {
      setBusy(false);
    }
  }, [busy, applyStatus]);

  const handleUninstall = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await uninstallHooks();
      setStatus(next);
      applyStatus(next);
    } catch (e) {
      toastCatch('FleetSettingsPage:uninstall', 'Failed to uninstall Claude Code hooks')(e);
    } finally {
      setBusy(false);
    }
  }, [busy, applyStatus]);

  const installed = status?.installed ?? false;

  return (
    <ContentBox>
      <ContentHeader
        icon={<SettingsIcon className="w-5 h-5 text-primary" />}
        title={debtText("auto_fleet_settings_27ca3375")}
        subtitle="Hook diagnostics and uninstall (install lives in the Sessions tab header)"
      />
      <ContentBody>
        <div data-type-density="compact" className="max-w-5xl mx-auto space-y-4" data-testid="fleet-settings-page">
          <FleetHookBanner status={status} />

          {/* Actions */}
          <div className="flex items-center gap-2" data-testid="fleet-settings-actions">
            <Button
              data-testid="fleet-install-hooks"
              variant={installed ? 'secondary' : 'primary'}
              size="sm"
              icon={<Download className="w-3.5 h-3.5" />}
              disabled={busy}
              onClick={handleInstall}
            >
              {installed ? 'Re-install hooks' : 'Install hooks'}
            </Button>
            <Button
              data-testid="fleet-uninstall-hooks"
              variant="danger"
              size="sm"
              icon={<Trash2 className="w-3.5 h-3.5" />}
              disabled={busy || !installed}
              onClick={handleUninstall}
            >
              Uninstall
            </Button>
            <Button
              data-testid="fleet-refresh-hooks"
              variant="ghost"
              size="sm"
              icon={<RefreshCw className="w-3.5 h-3.5" />}
              onClick={refresh}
            >
              Refresh
            </Button>
          </div>

          {status && <FleetHookEntries status={status} />}

          {/* Detected Claude processes + orphan cleanup (survives app restart) */}
          <FleetProcessScanner />

          {/* Auto-hibernate policy (F3/P3.2) — always-on idle-session sleep */}
          <FleetAutoHibernateSettings />

          {/* Tunable stale/frozen cutoffs — pushed to the Rust ticker */}
          <FleetStateCutoffSettings />

          {/* Terminal appearance + behaviour (font, copy-on-select, theme) */}
          <FleetTerminalSettings />

          {/* Pair a device — stage-1 scaffold for the mobile companion.
              Inert (no backend handshake yet), so it only mounts in dev
              builds until the pairing flow is real. */}
          {import.meta.env.DEV && <FleetPairDevice />}

          {/* Mobile companion glance preview — read-only, fed by live data */}
          <FleetMobilePreview />
        </div>
      </ContentBody>
    </ContentBox>
  );
}
