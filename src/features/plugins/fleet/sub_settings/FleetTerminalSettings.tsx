import { Terminal as TerminalIcon, ZoomIn, ZoomOut } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { FLEET_FONT_MIN, FLEET_FONT_MAX } from '../fleetTerminalManager';
import type { FleetTerminalTheme } from '@/stores/slices/system/fleetSlice';

/** Small inline segmented control — local to terminal settings. */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  testid,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  testid: string;
}) {
  return (
    <div
      className="flex items-center rounded-interactive border border-primary/10 bg-secondary/30 p-0.5"
      role="group"
      data-testid={testid}
    >
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          data-testid={`${testid}-${o.id}`}
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-interactive px-2 py-0.5 text-[11px] transition-colors ${
            value === o.id ? 'bg-primary/15 text-primary' : 'text-foreground/70 hover:text-foreground'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Terminal appearance + behaviour controls (font zoom, copy-on-select,
 * color theme). All values persist via the fleet slice and apply live to
 * every open terminal through the terminal manager / config hook (no remount
 * needed).
 */
export function FleetTerminalSettings() {
  const { t } = useTranslation();
  const fontSize = useSystemStore((s) => s.fleetTerminalFontSize);
  const nudgeFont = useSystemStore((s) => s.fleetNudgeTerminalFont);
  const copyOnSelect = useSystemStore((s) => s.fleetTerminalCopyOnSelect);
  const setCopyOnSelect = useSystemStore((s) => s.fleetSetTerminalCopyOnSelect);
  const theme = useSystemStore((s) => s.fleetTerminalTheme);
  const setTheme = useSystemStore((s) => s.fleetSetTerminalTheme);

  const themeOptions: { id: FleetTerminalTheme; label: string }[] = [
    { id: 'auto', label: t.plugins.fleet.settings_theme_auto },
    { id: 'dark', label: t.plugins.fleet.settings_theme_dark },
    { id: 'light', label: t.plugins.fleet.settings_theme_light },
  ];

  return (
    <div
      className="border border-primary/10 rounded-modal px-4 py-3 bg-secondary/20 space-y-3"
      data-testid="fleet-terminal-settings"
    >
      <div className="flex items-center gap-2">
        <TerminalIcon className="w-4 h-4 text-primary" />
        <div>
          <p className="typo-caption font-medium text-foreground">{t.plugins.fleet.settings_terminal_title}</p>
          <p className="text-[11px] text-foreground">{t.plugins.fleet.settings_terminal_desc}</p>
        </div>
      </div>

      {/* Font size */}
      <div className="flex items-center justify-between">
        <span className="typo-caption text-foreground">{t.plugins.fleet.settings_font_size}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            data-testid="fleet-settings-font-dec"
            onClick={() => nudgeFont(-1)}
            disabled={fontSize <= FLEET_FONT_MIN}
            aria-label={t.plugins.fleet.terminal_font_decrease}
            className="flex items-center rounded-interactive p-1 text-foreground transition-colors hover:bg-secondary/50 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="w-9 text-center tabular-nums text-[12px] text-foreground" data-testid="fleet-settings-font-value">
            {fontSize}px
          </span>
          <button
            type="button"
            data-testid="fleet-settings-font-inc"
            onClick={() => nudgeFont(1)}
            disabled={fontSize >= FLEET_FONT_MAX}
            aria-label={t.plugins.fleet.terminal_font_increase}
            className="flex items-center rounded-interactive p-1 text-foreground transition-colors hover:bg-secondary/50 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Color theme */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="typo-caption text-foreground">{t.plugins.fleet.settings_theme}</span>
          <p className="text-[11px] text-foreground">{t.plugins.fleet.settings_theme_desc}</p>
        </div>
        <Segmented value={theme} options={themeOptions} onChange={setTheme} testid="fleet-settings-theme" />
      </div>

      {/* Copy on select */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="typo-caption text-foreground">{t.plugins.fleet.settings_copy_on_select}</span>
          <p className="text-[11px] text-foreground">{t.plugins.fleet.settings_copy_on_select_desc}</p>
        </div>
        <AccessibleToggle
          checked={copyOnSelect}
          onChange={() => setCopyOnSelect(!copyOnSelect)}
          label={t.plugins.fleet.settings_copy_on_select}
          data-testid="fleet-settings-copy-on-select"
        />
      </div>
    </div>
  );
}
