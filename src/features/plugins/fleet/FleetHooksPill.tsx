import { useCallback, useState } from 'react';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { installHooks } from '@/api/fleet/fleet';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText, debtText } from '@/i18n/DebtText';
import Button from '@/features/shared/components/buttons/Button';
import { Tooltip } from '@/features/shared/components/display/Tooltip';


/**
 * Header-right indicator + click-to-install for Claude Code hooks.
 *
 * Compact alternative to the full settings banner. Three states:
 *   - installed (port matches) → emerald check + "Hooks · :port"
 *   - missing                  → neutral dot + "Install hooks" (clickable)
 *   - installing               → spinner + "Installing…"
 *
 * Designed for the ContentHeader `actions` slot — fits next to other
 * header controls without a separate banner row.
 */
export function FleetHooksPill() {
  const { t } = useTranslation();
  const installed = useSystemStore((s) => s.fleetHooksInstalled);
  const port = useSystemStore((s) => s.fleetHookPort);
  const applyStatus = useSystemStore((s) => s.fleetApplyHookStatus);
  const refresh = useSystemStore((s) => s.fleetRefresh);

  const [installing, setInstalling] = useState(false);

  const handleInstall = useCallback(async () => {
    if (installing || installed) return;
    setInstalling(true);
    try {
      const status = await installHooks();
      applyStatus(status);
      refresh();
    } catch (e) {
      toastCatch('FleetHooksPill:install', t.plugins.fleet.hooks_install_failed)(e);
    } finally {
      setInstalling(false);
    }
  }, [installing, installed, applyStatus, refresh, t]);

  if (installing) {
    return (
      <span
        data-testid="fleet-hooks-pill-installing"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-card border border-hair bg-surface-1 typo-caption text-foreground"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <DebtText k="auto_installing_8d278823" />
      </span>
    );
  }

  if (installed) {
    return (
      <Tooltip content={`Claude Code hooks routed to http://127.0.0.1:${port}/fleet/hooks/*`}><span
        data-testid="fleet-hooks-pill-installed"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-card border border-hair bg-surface-1 typo-caption text-status-success"
      >
        <CheckCircle2 className="w-3 h-3" />
        <DebtText k="auto_hooks_c32c426b" />{port}
      </span></Tooltip>
    );
  }

  return (
    <Button variant="secondary" size="sm"
      type="button"
      data-testid="fleet-hooks-pill-install"
      onClick={handleInstall}
      tooltip={debtText("auto_install_hooks_into_claude_settings_json_so_240d2895")}
    >
      <AlertCircle className="w-3 h-3" />
      <DebtText k="auto_install_hooks_38a73c04" />
    </Button>
  );
}
