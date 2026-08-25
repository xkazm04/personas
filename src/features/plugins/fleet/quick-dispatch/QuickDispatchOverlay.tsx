import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { ChatInputBar } from '@/features/shared/components/forms/ChatInputBar';
import { useQuickDispatchStore } from '@/stores/quickDispatchStore';

/**
 * Quick Dispatch overlay — SHELL ONLY for now.
 *
 * Opened by the nav-mode `C` key (see `TitleBarDock`); there is deliberately no
 * titlebar capsule for it. Mirrors the `CommandPalette` mounting idiom: an
 * unpainted `fixed inset-0` container (the paint lives on a separate
 * `absolute inset-0` scrim child, which is also what keeps this outside the
 * `hand-painted-modal-backdrop` census rule), a centered card at ~15vh, close
 * on scrim click and on Escape via a React `onKeyDown` inside the surface —
 * NOT a global keyboard claim.
 *
 * A follow-up work package replaces the placeholder input with the real fleet
 * session composer; `onSubmit` is a no-op until then.
 */
export default function QuickDispatchOverlay() {
  const { t } = useTranslation();
  const open = useQuickDispatchStore((s) => s.open);
  const closeQuickDispatch = useQuickDispatchStore((s) => s.closeQuickDispatch);
  const [value, setValue] = useState('');
  const cardRef = useRef<HTMLDivElement>(null);

  // Same focus idiom as CommandPalette: reset, then focus on the next frame so
  // the field exists (and the entrance animation has committed) before focus.
  useEffect(() => {
    if (open) {
      setValue('');
      requestAnimationFrame(() => {
        cardRef.current?.querySelector('textarea')?.focus();
      });
    }
  }, [open]);

  if (!open) return null;

  // Deliberately a SIBLING of `plugins.fleet`, not nested inside it: the fleet
  // section is a flat string map that the fleet UI indexes via
  // `keyof Translations['plugins']['fleet']` (FleetStatusDots, monitorMeta, …),
  // and a nested object there breaks every one of those lookups.
  const quickT = t.plugins.fleet_quick_dispatch;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh]"
      data-testid="quick-dispatch-overlay"
    >
      <div
        className="animate-fade-slide-in absolute inset-0 bg-black/50 backdrop-blur-md"
        onClick={closeQuickDispatch}
        aria-label={quickT.close}
      />
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={quickT.title}
        className="animate-fade-slide-in relative w-full max-w-lg glass-md rounded-modal shadow-elevation-4 p-3"
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            closeQuickDispatch();
          }
        }}
      >
        <ChatInputBar
          value={value}
          onChange={setValue}
          onSubmit={() => {
            /* The composer work package wires the real dispatch. */
          }}
          multiline
          placeholder={quickT.placeholder}
          inputTestId="quick-dispatch-input"
        />
      </div>
    </div>
  );
}
