import { X, Keyboard } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';

type FleetKeys = keyof Translations['plugins']['fleet'];

/** Shortcut rows — key glyphs are universal, descriptions are i18n'd. */
const SHORTCUTS: ReadonlyArray<{ keys: string[]; labelKey: FleetKeys }> = [
  { keys: ['N'], labelKey: 'hotkey_next_waiting' },
  { keys: ['↑', '↓'], labelKey: 'hotkey_move_focus' },
  { keys: ['/'], labelKey: 'hotkey_focus_search' },
  { keys: ['G'], labelKey: 'hotkey_toggle_grid' },
  { keys: ['?'], labelKey: 'hotkey_show_help' },
];

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex min-w-[22px] items-center justify-center rounded border border-primary/15 bg-secondary/50 px-1.5 py-0.5 text-[11px] font-medium text-foreground">
      {children}
    </kbd>
  );
}

/**
 * Shortcuts reference for the Sessions-tab triage hotkey layer
 * (`useFleetHotkeys`). Opened by the `?` key or the keyboard button in the
 * page header. Pure presentation — the active key handling lives in the hook.
 */
export function FleetHotkeysHelp({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <BaseModal
      isOpen={open}
      onClose={onClose}
      titleId="fleet-hotkeys-title"
      size="sm"
      panelClassName="bg-background border border-primary/10 rounded-2xl p-5 shadow-elevation-4"
    >
      <div data-testid="fleet-hotkeys-help">
        <div className="flex items-center justify-between mb-4">
          <h2 id="fleet-hotkeys-title" className="typo-section-title flex items-center gap-2">
            <Keyboard className="w-4 h-4 text-primary" aria-hidden="true" />
            {t.plugins.fleet.hotkeys_title}
          </h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t.common.close}>
            <X className="w-4 h-4" />
          </Button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s) => (
            <li key={s.labelKey} className="flex items-center justify-between gap-3">
              <span className="text-[13px] text-foreground">{t.plugins.fleet[s.labelKey]}</span>
              <span className="flex items-center gap-1">
                {s.keys.map((k) => (
                  <Kbd key={k}>{k}</Kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-[12px] text-foreground">{t.plugins.fleet.hotkeys_typing_note}</p>
      </div>
    </BaseModal>
  );
}
