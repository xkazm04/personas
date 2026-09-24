import type { ReactNode } from 'react';
import { Terminal as TerminalIcon, ZoomIn, ZoomOut } from 'lucide-react';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { Button } from '@/features/shared/components/buttons';
import { SegmentedTabs } from '@/features/shared/components/layout/SegmentedTabs';
import { FLEET_FONT_MIN, FLEET_FONT_MAX } from '../fleetTerminalManager';
import type { FleetTerminalTheme } from '@/stores/slices/system/fleetSlice';
import { FleetSettingsCard } from './FleetSettingsCard';
import { TerminalBudgets } from './FleetTerminalBudgets';

/** One setting: its name and a caption on the left, the control on the right. */
function Row({ label, description, children }: { label: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="typo-title">{label}</p>
        {description && <p className="typo-caption">{description}</p>}
      </div>
      {children}
    </div>
  );
}

const THEME_TESTID = 'fleet-settings-theme';

/**
 * Terminal appearance + behaviour controls (font zoom, copy-on-select,
 * color theme). All values persist via the fleet slice and apply live to
 * every open terminal through the terminal manager / config hook (no remount
 * needed).
 */
export function FleetTerminalSettings() {
  const { t } = useTranslation();
  const f = t.plugins.fleet;
  const fontSize = useSystemStore((s) => s.fleetTerminalFontSize);
  const nudgeFont = useSystemStore((s) => s.fleetNudgeTerminalFont);
  const copyOnSelect = useSystemStore((s) => s.fleetTerminalCopyOnSelect);
  const setCopyOnSelect = useSystemStore((s) => s.fleetSetTerminalCopyOnSelect);
  const theme = useSystemStore((s) => s.fleetTerminalTheme);
  const setTheme = useSystemStore((s) => s.fleetSetTerminalTheme);

  const themeTabs: { id: FleetTerminalTheme; label: string; testId: string }[] = [
    { id: 'auto', label: f.settings_theme_auto, testId: `${THEME_TESTID}-auto` },
    { id: 'dark', label: f.settings_theme_dark, testId: `${THEME_TESTID}-dark` },
    { id: 'light', label: f.settings_theme_light, testId: `${THEME_TESTID}-light` },
  ];

  return (
    <FleetSettingsCard
      data-testid="fleet-terminal-settings"
      icon={<TerminalIcon className="w-4 h-4 text-primary" />}
      title={f.settings_terminal_title}
      description={f.settings_terminal_desc}
    >
      <div className="space-y-3">
        <Row label={f.settings_font_size}>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="fleet-settings-font-dec"
              onClick={() => nudgeFont(-1)}
              disabled={fontSize <= FLEET_FONT_MIN}
              aria-label={f.terminal_font_decrease}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <span className="w-10 text-center typo-data text-foreground" data-testid="fleet-settings-font-value">
              {fontSize}px
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              data-testid="fleet-settings-font-inc"
              onClick={() => nudgeFont(1)}
              disabled={fontSize >= FLEET_FONT_MAX}
              aria-label={f.terminal_font_increase}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
          </div>
        </Row>

        <Row label={f.settings_theme} description={f.settings_theme_desc}>
          <div data-testid={THEME_TESTID} className="shrink-0">
            <SegmentedTabs
              tabs={themeTabs}
              activeTab={theme}
              onTabChange={setTheme}
              ariaLabel={f.settings_theme}
              size="sm"
              fullWidth={false}
            />
          </div>
        </Row>

        <Row label={f.settings_copy_on_select} description={f.settings_copy_on_select_desc}>
          <AccessibleToggle
            checked={copyOnSelect}
            onChange={() => setCopyOnSelect(!copyOnSelect)}
            label={f.settings_copy_on_select}
            data-testid="fleet-settings-copy-on-select"
          />
        </Row>

        <TerminalBudgets />
      </div>
    </FleetSettingsCard>
  );
}
