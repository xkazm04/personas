import type { ReactNode } from 'react';
import { Gauge, Inbox, LayoutGrid, Settings } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useRovingTabIndex } from '@/hooks/utility/interaction/useRovingTabIndex';
import { useTranslation } from '@/i18n/useTranslation';
import type { SimpleTab } from '@/stores/slices/system/simpleModeSlice';

interface SimpleHomeShellProps {
  activeTab: SimpleTab;
  onTabChange: (tab: SimpleTab) => void;
  onSwitchToPower: () => void;
  onOpenSettings: () => void;
  children: ReactNode;
}

interface TabDef {
  id: SimpleTab;
  labelKey: 'tab_mosaic' | 'tab_console' | 'tab_inbox';
  Icon: typeof LayoutGrid;
}

const TABS: readonly TabDef[] = [
  { id: 'mosaic', labelKey: 'tab_mosaic', Icon: LayoutGrid },
  { id: 'console', labelKey: 'tab_console', Icon: Gauge },
  { id: 'inbox', labelKey: 'tab_inbox', Icon: Inbox },
] as const;

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Shared visual shell for the Simple-mode Home Base: thin top bar with
 * title/subtitle on the left, a 3-tab switcher in the center, and
 * Settings + Switch-to-Power actions on the right. Renders `children`
 * below as the variant body.
 *
 * All user-facing strings route through `useTranslation()` per CLAUDE.md.
 */
export function SimpleHomeShell({
  activeTab,
  onTabChange,
  onSwitchToPower,
  onOpenSettings,
  children,
}: SimpleHomeShellProps) {
  const { t } = useTranslation();
  const activeIndex = Math.max(
    0,
    TABS.findIndex((tab) => tab.id === activeTab),
  );
  const { setRef, onKeyDown } = useRovingTabIndex<HTMLButtonElement>(
    TABS.length,
    activeIndex,
    (next) => {
      const tab = TABS[next];
      if (tab) onTabChange(tab.id);
    },
  );

  return (
    <div className="simple-surface h-full flex flex-col">
      <header className="flex items-center gap-4 px-5 py-2.5 border-b border-border/60 bg-background/80">
        {/* Left: title + subtitle */}
        <div className="flex flex-col min-w-0 flex-shrink-0">
          <h1 className="typo-heading simple-display text-foreground leading-tight">
            {t.simple_mode.title}
          </h1>
          <p className="typo-caption text-foreground/60 leading-tight truncate">
            {t.simple_mode.subtitle}
          </p>
        </div>

        {/* Center: tab switcher */}
        <nav
          role="tablist"
          aria-label={t.simple_mode.title}
          aria-orientation="horizontal"
          className="flex items-center gap-1 mx-auto"
        >
          {TABS.map(({ id, labelKey, Icon }, index) => {
            const isActive = id === activeTab;
            return (
              <button
                key={id}
                ref={setRef(index)}
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={isActive ? 0 : -1}
                onClick={() => onTabChange(id)}
                onKeyDown={onKeyDown}
                className={[
                  'typo-caption flex items-center gap-1.5 px-3 py-1.5 rounded-xl transition-colors',
                  FOCUS_RING,
                  isActive
                    ? 'bg-foreground/[0.06] border border-primary/15 text-foreground'
                    : 'border border-transparent text-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground',
                ].join(' ')}
              >
                <Icon className="w-4 h-4" />
                <span>{t.simple_mode[labelKey]}</span>
              </button>
            );
          })}
        </nav>

        {/* Right: settings gear + switch-to-power */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label={t.simple_mode.open_settings}
            title={t.simple_mode.open_settings}
            className={`w-9 h-9 rounded-xl flex items-center justify-center text-foreground/70 hover:text-foreground hover:bg-foreground/[0.04] transition-colors ${FOCUS_RING}`}
          >
            <Settings className="w-4 h-4" />
          </button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onSwitchToPower}
            className={`simple-accent-violet-text simple-accent-violet-border simple-accent-violet-soft border hover:brightness-110 ${FOCUS_RING}`}
          >
            {t.simple_mode.switch_to_power}
          </Button>
        </div>
      </header>

      <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
    </div>
  );
}
