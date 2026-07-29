/**
 * StaticScanConfigModal — set the deterministic static-analysis tool + command
 * for a project (`dev_tools_set_static_scan_config`). Opened from the Idea
 * Scanner when "Static Scan" is pressed with no config yet — replacing the old
 * doomed run that surfaced a confusing generic validation error. On save it
 * persists the config and (optionally) runs the scan immediately.
 */
import { useState } from 'react';
import { Binary, X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { Button, AsyncButton } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { setStaticScanConfig } from '@/api/devTools/devTools';
import type { StaticScanConfig } from '@/lib/bindings/StaticScanConfig';
import type { StaticScanTool } from '@/lib/bindings/StaticScanTool';

const TOOLS: StaticScanTool[] = ['fallow', 'knip', 'jscpd'];

export function StaticScanConfigModal({
  open, onClose, projectId, initialConfig, onSaved,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string | null;
  initialConfig: StaticScanConfig | null;
  /** Called after a successful save with the saved config (page may auto-run). */
  onSaved: (config: StaticScanConfig) => void;
}) {
  const { t } = useTranslation();
  const ds = t.plugins.dev_scanner;
  const addToast = useToastStore((s) => s.addToast);

  const [tool, setTool] = useState<StaticScanTool>(initialConfig?.tool ?? 'fallow');
  const [command, setCommand] = useState(initialConfig?.command?.join(' ') ?? 'npx fallow scan --json');

  const handleSave = async () => {
    if (!projectId) return;
    const argv = command.trim().split(/\s+/).filter(Boolean);
    if (argv.length === 0) {
      addToast(ds.static_config_command_required, 'error');
      return;
    }
    const config: StaticScanConfig = { tool, command: argv };
    try {
      await setStaticScanConfig(projectId, config);
      addToast(ds.static_config_saved, 'success');
      onSaved(config);
      onClose();
    } catch (err) {
      toastCatch('StaticScanConfigModal:save', ds.static_config_save_failed)(err);
    }
  };

  if (!open) return null;

  return (
    <BaseModal isOpen={open} onClose={onClose} titleId="static-scan-config" size="sm">
      <div className="flex flex-col">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-border">
          <Binary className="w-4 h-4 text-emerald-400" />
          <h2 id="static-scan-config" className="typo-heading text-foreground flex-1">{ds.static_config_title}</h2>
          <button type="button" onClick={onClose} aria-label={t.common.cancel} className="p-1 rounded-interactive text-foreground hover:bg-secondary/50 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="typo-caption text-foreground">{ds.static_config_intro}</p>

          <div className="space-y-1.5">
            <label className="typo-caption font-medium text-foreground">{ds.static_config_tool_label}</label>
            <ThemedSelect value={tool} onValueChange={(v) => setTool(v as StaticScanTool)}>
              {TOOLS.map((tl) => (
                <option key={tl} value={tl}>{tl}{tl === 'fallow' ? ` (${ds.static_config_recommended})` : ''}</option>
              ))}
            </ThemedSelect>
          </div>

          <div className="space-y-1.5">
            <label className="typo-caption font-medium text-foreground">{ds.static_config_command_label}</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="w-full px-3 py-2 typo-body font-mono bg-secondary/40 border border-primary/10 rounded-input text-foreground placeholder:text-foreground/40 focus-ring"
            />
            <p className="typo-caption text-foreground">{ds.static_config_command_hint}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border">
          <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
          <AsyncButton variant="accent" accentColor="emerald" size="sm" onClick={handleSave}>
            {ds.static_config_save_run}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
