import { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, CheckCircle2, AlertCircle, RefreshCw, Trash2, Download } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { checkHooks, installHooks, uninstallHooks } from '@/api/fleet/fleet';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';
import { DebtText, debtText } from '@/i18n/DebtText';


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
  const portMismatch = status?.installed && !status.portMatches;

  return (
    <ContentBox>
      <ContentHeader
        icon={<SettingsIcon className="w-5 h-5 text-primary" />}
        title={debtText("auto_fleet_settings_27ca3375")}
        subtitle="Hook diagnostics and uninstall (install lives in the Sessions tab header)"
      />
      <ContentBody>
        <div className="space-y-4" data-testid="fleet-settings-page">
          {/* Banner */}
          {!status ? (
            <div
              className="border border-primary/10 rounded-modal bg-primary/5 px-4 py-3"
              data-testid="fleet-hooks-banner-loading"
            >
              <p className="typo-caption text-foreground"><DebtText k="auto_loading_hook_status_23866317" /></p>
            </div>
          ) : portMismatch ? (
            <div
              className="border border-orange-500/25 rounded-modal bg-orange-500/5 px-4 py-3"
              data-testid="fleet-hooks-banner-mismatch"
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-orange-400" />
                <p className="typo-caption font-medium text-orange-300"><DebtText k="auto_port_mismatch_b07961a1" /></p>
              </div>
              <p className="text-[12px] text-foreground leading-relaxed">
                <DebtText k="auto_hooks_point_to_port_36464ae7" />{' '}
                <code className="font-mono">{status.installedPort ?? '?'}</code> <DebtText k="auto_but_the_current_in_app_http_server_bound_t_ffe9bca1" />
              </p>
            </div>
          ) : installed ? (
            <div
              className="border border-emerald-500/25 rounded-modal bg-emerald-500/5 px-4 py-3"
              data-testid="fleet-hooks-banner-installed"
            >
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <p className="typo-caption font-medium text-emerald-400"><DebtText k="auto_hooks_installed_dfe5c9be" /></p>
              </div>
              <p className="text-[12px] text-foreground leading-relaxed">
                <DebtText k="auto_claude_code_posts_lifecycle_events_to_f1cd7ead" />{' '}
                <code className="font-mono"><DebtText k="auto_http_127_0_0_1_7c241e82" />{status.installedPort}<DebtText k="auto_fleet_hooks_40b93aeb" /></code><DebtText k="auto_sessions_you_spawn_from_fleet_and_any_exte_cbcbfcc7" />{' '}
                <code className="font-mono">claude</code> <DebtText k="auto_runs_with_the_same_cwd_report_state_in_rea_26cd9b3d" />
              </p>
            </div>
          ) : (
            <div
              className="border border-primary/15 rounded-modal bg-primary/5 px-4 py-3"
              data-testid="fleet-hooks-banner-missing"
            >
              <p className="typo-caption font-medium text-foreground mb-1"><DebtText k="auto_hooks_not_installed_772fd030" /></p>
              <p className="text-[12px] text-foreground leading-relaxed">
                <DebtText k="auto_fleet_needs_six_hook_entries_in_27ce6397" />{' '}
                <code className="font-mono"><DebtText k="auto_claude_settings_json_3ce7a994" /></code> <DebtText k="auto_sessionstart_notification_stop_pretooluse__9837beb9" />{' '}
                <code className="font-mono"><DebtText k="auto_fleet_true_cfae4a45" /></code> <DebtText k="auto_marker_so_uninstall_is_surgical_a97c8e30" />
              </p>
            </div>
          )}

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

          {/* Detailed breakdown */}
          {status && (
            <div className="border border-primary/10 rounded-modal px-4 py-3 bg-secondary/20">
              <p className="typo-caption font-medium text-foreground mb-2"><DebtText k="auto_hook_entries_e7af67cb" /></p>
              <ul className="space-y-1">
                {[...status.presentEvents, ...status.missingEvents].sort().map((event) => {
                  const present = status.presentEvents.includes(event);
                  return (
                    <li key={event} className="flex items-center gap-2 text-[11px]">
                      {present ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 text-foreground flex-shrink-0" />
                      )}
                      <code className="font-mono text-foreground">{event}</code>
                      <span className="text-foreground">
                        {present ? '— installed' : '— not installed'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </ContentBody>
    </ContentBox>
  );
}
