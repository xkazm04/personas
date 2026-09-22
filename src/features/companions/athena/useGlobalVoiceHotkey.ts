import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  COMPANION_HOTKEY_EVENT,
  COMPANION_VOICE_HOTKEY,
  companionSetVoiceHotkey,
} from '@/api/companion';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useSystemStore } from '@/stores/systemStore';
import { getActiveTranslations } from '@/i18n/useTranslation';

/**
 * Registers Athena's push-to-talk chord as an OS-level accelerator while
 * `companionGlobalHotkeyEnabled` is on, and runs `onFire` when it fires.
 *
 * This is the reachability half of the voice stack. Everything else — local
 * whisper capture, Kokoro playback, `useHoldToTalk`, the orb — already worked,
 * but only while the Personas window had focus, because all of it is armed
 * from inside the WebView. The accelerator is what lets the user talk to
 * Athena from whatever application they are actually working in.
 *
 * The chord is deliberately the same `Cmd/Ctrl+Shift+A` the in-app keyboard
 * handler uses, and `onFire` is that handler's own callback: one chord, one
 * behaviour, two scopes.
 *
 * Mount once (from `AthenaOrbLayer`, which is itself mounted once in
 * `App.tsx`). Mounting it twice would have the second instance's unregister
 * tear down the first's binding.
 */
export function useGlobalVoiceHotkey(onFire: () => void) {
  const enabled = useSystemStore((s) => s.companionGlobalHotkeyEnabled);
  const setEnabled = useSystemStore((s) => s.setCompanionGlobalHotkeyEnabled);

  // `onFire` closes over `talking` and so changes identity most renders.
  // Holding it in a ref keeps the subscription effect's deps empty, so the
  // event listener is attached once instead of being torn down and rebuilt on
  // every keystroke of state.
  const onFireRef = useRef(onFire);
  useEffect(() => {
    onFireRef.current = onFire;
  }, [onFire]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    void listen(COMPANION_HOTKEY_EVENT, () => {
      onFireRef.current();
    })
      .then((fn) => {
        if (cancelled) {
          fn();
          return;
        }
        unlisten = fn;
      })
      .catch(silentCatch('useGlobalVoiceHotkey.listen'));

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    companionSetVoiceHotkey(enabled ? COMPANION_VOICE_HOTKEY : null).catch(
      (err: unknown) => {
        if (cancelled) return;
        // The usual cause is another application already owning the chord.
        // Flip the toggle back off rather than leaving the settings UI
        // claiming a binding the OS refused — a switch that reads "on" while
        // nothing is bound is worse than one that visibly failed.
        setEnabled(false);
        const t = getActiveTranslations();
        useToastStore
          .getState()
          .addToast(t.plugins.companion.global_hotkey_failed, 'error');
        silentCatch('useGlobalVoiceHotkey.register')(err);
      },
    );

    return () => {
      cancelled = true;
    };
  }, [enabled, setEnabled]);
}
