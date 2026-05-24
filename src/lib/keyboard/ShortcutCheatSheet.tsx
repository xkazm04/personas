import { useCallback, useEffect, useState } from 'react';
import { Keyboard } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { useTranslation } from '@/i18n/useTranslation';
import {
  SHORTCUT_GROUPS,
  SHORTCUTS_OPEN_EVENT,
  resolveKeyToken,
} from '@/lib/keyboard/shortcutRegistry';

const TITLE_ID = 'shortcut-cheat-sheet-title';

/** Don't hijack `?` / `/` while the user is typing into a field. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/**
 * App-global keyboard-shortcut cheat-sheet. Opens on `?` or Cmd/Ctrl+/ (and
 * via the `SHORTCUTS_OPEN_EVENT` dispatched by the footer affordance), then
 * renders every binding from the keyboard registry grouped by section. Closes
 * on Escape via `BaseModal`'s built-in handling.
 */
export default function ShortcutCheatSheet() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useAppKeyboard(
    (e) => {
      if (isTypingTarget(e.target)) return false;
      const isQuestion = e.key === '?';
      const isModSlash = (e.metaKey || e.ctrlKey) && e.key === '/';
      if (!isQuestion && !isModSlash) return false;
      e.preventDefault();
      setOpen((prev) => !prev);
      return true;
    },
    { priority: 20 },
  );

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener(SHORTCUTS_OPEN_EVENT, handler);
    return () => window.removeEventListener(SHORTCUTS_OPEN_EVENT, handler);
  }, []);

  return (
    <BaseModal
      isOpen={open}
      onClose={close}
      titleId={TITLE_ID}
      size="md"
      portal
      staggerChildren={false}
    >
      <div className="flex flex-col">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-primary/10">
          <div className="w-8 h-8 rounded-card bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
            <Keyboard className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <h2 id={TITLE_ID} className="typo-body font-semibold text-foreground">
              {t.chrome.shortcuts.title}
            </h2>
            <p className="typo-caption text-foreground/85 truncate">{t.chrome.shortcuts.subtitle}</p>
          </div>
        </div>

        <div className="px-5 py-4 grid gap-5 max-h-[60vh] overflow-y-auto">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.section}>
              <h3 className="typo-caption uppercase tracking-wider text-foreground/85 font-medium mb-2">
                {group.title(t)}
              </h3>
              <div className="space-y-1.5">
                {group.bindings.map((binding, bi) => (
                  <div key={bi} className="flex items-center justify-between gap-4">
                    <span className="typo-body text-foreground/85">{binding.describe(t)}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {binding.combos.map((combo, ci) => (
                        <span key={ci} className="flex items-center gap-1">
                          {ci > 0 && (
                            <span className="text-foreground/85 text-[11px] px-0.5">/</span>
                          )}
                          {combo.map((token, ki) => (
                            <kbd
                              key={ki}
                              className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-input border border-primary/15 bg-secondary/40 text-[11px] font-medium text-foreground/85"
                            >
                              {resolveKeyToken(token)}
                            </kbd>
                          ))}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </BaseModal>
  );
}
