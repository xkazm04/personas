import { Keyboard } from 'lucide-react';
import { SectionCard } from '@/features/shared/components/layout/SectionCard';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { COMPANION_VOICE_HOTKEY } from '@/api/companion';

/**
 * Push-to-talk reachability — whether Athena's voice chord also works while
 * another application has focus.
 *
 * The chord itself is not editable here. It is fixed to the same
 * `Cmd/Ctrl+Shift+A` the in-app handler already uses, so this setting answers
 * one question — does that chord reach outside the window — rather than
 * introducing a second binding the user has to keep in sync with the first.
 * The backend command accepts an arbitrary accelerator, so a rebinding UI can
 * be added later without touching the Rust side.
 *
 * Registration failure (usually another application already owning the chord)
 * flips the toggle back off and toasts, so the switch never reads "on" while
 * nothing is actually bound. That handling lives in `useGlobalVoiceHotkey`,
 * which owns the registration.
 */
export function GlobalHotkeyCard() {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const enabled = useSystemStore((s) => s.companionGlobalHotkeyEnabled);
  const setEnabled = useSystemStore((s) => s.setCompanionGlobalHotkeyEnabled);

  return (
    <SectionCard
      title={c.global_hotkey_title}
      subtitle={c.global_hotkey_desc}
      titleClassName="text-primary"
      icon={
        <Keyboard
          className={`w-4 h-4 ${enabled ? 'text-emerald-400' : 'text-foreground'}`}
        />
      }
      status={enabled ? 'success' : 'neutral'}
      action={
        <AccessibleToggle
          checked={enabled}
          onChange={() => setEnabled(!enabled)}
          label={enabled ? c.global_hotkey_disable : c.global_hotkey_enable}
        />
      }
    >
      <div className="flex items-center gap-2">
        <kbd className="typo-code rounded-card border border-border/60 bg-secondary/40 px-2 py-1 text-foreground">
          {COMPANION_VOICE_HOTKEY}
        </kbd>
        <span className="typo-caption text-foreground">
          {enabled ? c.global_hotkey_active : c.global_hotkey_in_app_only}
        </span>
      </div>
    </SectionCard>
  );
}
