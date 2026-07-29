/**
 * StaticScanConfigModal — set the deterministic static-analysis tool + command
 * for a project (`dev_tools_set_static_scan_config`). Opened from the Idea
 * Scanner when "Static Scan" is pressed with no config yet — replacing the old
 * doomed run that surfaced a confusing generic validation error. On save it
 * persists the config and (optionally) runs the scan immediately.
 */
import { useState } from 'react';
import { Binary } from 'lucide-react';
import { BaseModal } from '@/features/shared/components/modals';
import { Button, AsyncButton } from '@/features/shared/components/buttons';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import { useTranslation } from '@/i18n/useTranslation';
import { useToastStore } from '@/stores/toastStore';
import { toastCatch } from '@/lib/silentCatch';
import { setStaticScanConfig } from '@/api/devTools/devTools';
import type { StaticScanConfig } from '@/lib/bindings/StaticScanConfig';
import type { StaticScanTool } from '@/lib/bindings/StaticScanTool';

const TOOLS: StaticScanTool[] = ['fallow', 'knip', 'jscpd', 'impeccable'];

/** Argv that makes each tool emit the JSON its parser expects. Only the tools
 *  with a real parser get one; the rest keep the generic placeholder. */
const DEFAULT_COMMAND: Partial<Record<StaticScanTool, string>> = {
  fallow: 'npx fallow scan --json',
  // The detector needs no install and no API key, so `npx` on demand is the
  // whole setup. `--no-advisory` drops the rules the tool itself refuses to
  // count as failures, which have no place in a backlog.
  impeccable: 'npx impeccable detect --json --no-advisory src',
};

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
  const d = t.plugins.dev_tools;
  const addToast = useToastStore((s) => s.addToast);

  const [tool, setTool] = useState<StaticScanTool>(initialConfig?.tool ?? 'fallow');
  const [command, setCommand] = useState(initialConfig?.command?.join(' ') ?? DEFAULT_COMMAND.fallow!);

  /** Switching tool swaps in that tool's default argv — but never clobbers a
   *  command the user has edited away from the outgoing tool's default. */
  const handleToolChange = (next: StaticScanTool) => {
    const outgoingDefault = DEFAULT_COMMAND[tool];
    setTool(next);
    if (command.trim() === (outgoingDefault ?? '').trim() && DEFAULT_COMMAND[next]) {
      setCommand(DEFAULT_COMMAND[next]!);
    }
  };

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

  return (
    // Same modal chrome as the sibling skills dialogs (Use / Adopt): tinted
    // header band with icon + title, spaced body, secondary-tinted footer.
    <BaseModal isOpen={open} onClose={onClose} titleId="static-scan-config" size="md" portal staggerChildren={false}>
      <div className="flex flex-col" data-testid="static-scan-config-modal">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-primary/10 bg-primary/[0.04]">
          <Binary className="w-4 h-4 text-status-success flex-shrink-0" aria-hidden />
          <span id="static-scan-config" className="typo-title truncate">{ds.static_config_title}</span>
          <span className="ml-auto typo-label text-foreground/40 uppercase tracking-[0.1em] flex-shrink-0">{d.skills_static_title}</span>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="typo-caption text-foreground/70 leading-relaxed">{ds.static_config_intro}</p>

          <div className="space-y-1.5">
            <label className="typo-label text-foreground/55 block">{ds.static_config_tool_label}</label>
            <ThemedSelect value={tool} onValueChange={(v) => handleToolChange(v as StaticScanTool)}>
              {TOOLS.map((tl) => (
                <option key={tl} value={tl}>{tl}{tl === 'fallow' ? ` (${ds.static_config_recommended})` : ''}</option>
              ))}
            </ThemedSelect>
          </div>

          <div className="space-y-1.5">
            <label className="typo-label text-foreground/55 block">{ds.static_config_command_label}</label>
            <input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="w-full px-3 py-2 typo-body font-mono bg-background/70 border border-primary/15 rounded-input text-foreground placeholder:text-foreground/40 outline-none focus:border-primary/40"
            />
            <p className="typo-label text-foreground/45 leading-snug">{ds.static_config_command_hint}</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-2.5 border-t border-primary/10 bg-secondary/10">
          <Button variant="ghost" size="sm" onClick={onClose}>{t.common.cancel}</Button>
          <AsyncButton variant="accent" accentColor="emerald" size="sm" onClick={handleSave}>
            {ds.static_config_save_run}
          </AsyncButton>
        </div>
      </div>
    </BaseModal>
  );
}
