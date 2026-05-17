import { useState, useEffect, useCallback } from 'react';
import { Settings as SettingsIcon, CheckCircle2, AlertCircle, RefreshCw, Trash2, Download } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { toastCatch, silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { checkHooks, installHooks, uninstallHooks } from '@/api/fleet/fleet';
import type { FleetHookStatus } from '@/lib/bindings/FleetHookStatus';

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
        title="Fleet — Settings"
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
              <p className="typo-caption text-foreground/60">Loading hook status…</p>
            </div>
          ) : portMismatch ? (
            <div
              className="border border-orange-500/25 rounded-modal bg-orange-500/5 px-4 py-3"
              data-testid="fleet-hooks-banner-mismatch"
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertCircle className="w-4 h-4 text-orange-400" />
                <p className="typo-caption font-medium text-orange-300">Port mismatch</p>
              </div>
              <p className="text-[12px] text-foreground/70 leading-relaxed">
                Hooks point to port{' '}
                <code className="font-mono">{status.installedPort ?? '?'}</code> but the current
                in-app HTTP server bound to a different one (the previous app holding the canonical
                port hadn't released it). Re-install to update the entries.
              </p>
            </div>
          ) : installed ? (
            <div
              className="border border-emerald-500/25 rounded-modal bg-emerald-500/5 px-4 py-3"
              data-testid="fleet-hooks-banner-installed"
            >
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <p className="typo-caption font-medium text-emerald-400">Hooks installed</p>
              </div>
              <p className="text-[12px] text-foreground/70 leading-relaxed">
                Claude Code POSTs lifecycle events to{' '}
                <code className="font-mono">http://127.0.0.1:{status.installedPort}/fleet/hooks/*</code>.
                Sessions you spawn from Fleet, and any external{' '}
                <code className="font-mono">claude</code> runs with the same cwd, report state in
                real time.
              </p>
            </div>
          ) : (
            <div
              className="border border-primary/15 rounded-modal bg-primary/5 px-4 py-3"
              data-testid="fleet-hooks-banner-missing"
            >
              <p className="typo-caption font-medium text-foreground mb-1">Hooks not installed</p>
              <p className="text-[12px] text-foreground/70 leading-relaxed">
                Fleet needs six hook entries in{' '}
                <code className="font-mono">~/.claude/settings.json</code> (SessionStart,
                Notification, Stop, PreToolUse, SessionEnd, UserPromptSubmit). Install from the
                Sessions tab header pill, or click below. Each entry carries a{' '}
                <code className="font-mono">_fleet: true</code> marker so uninstall is surgical.
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
              <p className="typo-caption font-medium text-foreground mb-2">Hook entries</p>
              <ul className="space-y-1">
                {[...status.presentEvents, ...status.missingEvents].sort().map((event) => {
                  const present = status.presentEvents.includes(event);
                  return (
                    <li key={event} className="flex items-center gap-2 text-[11px]">
                      {present ? (
                        <CheckCircle2 className="w-3 h-3 text-emerald-400 flex-shrink-0" />
                      ) : (
                        <AlertCircle className="w-3 h-3 text-foreground/40 flex-shrink-0" />
                      )}
                      <code className="font-mono text-foreground/80">{event}</code>
                      <span className="text-foreground/50">
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
