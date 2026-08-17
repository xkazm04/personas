import { useEffect, useRef } from 'react';
import { AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useOverviewStore } from "@/stores/overviewStore";
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import type { FiredAlert } from '@/lib/bindings/FiredAlert';
import { STATUS_PALETTE } from '@/lib/design/statusTokens';

// Border/bg accents are derived from the central STATUS_PALETTE (single
// source of truth for the blue/amber/red severity palette used across the
// app) — only the icon/icon-color association is genuinely local to the
// toast. `alert.severity` uses 'critical' where the token map uses 'error';
// normalize here instead of hand-rolling a second color map.
const SEVERITY_ICONS: Record<string, { icon: typeof Info; iconColor: string }> = {
  info: { icon: Info, iconColor: STATUS_PALETTE.info.text },
  warning: { icon: AlertTriangle, iconColor: STATUS_PALETTE.warning.text },
  critical: { icon: XCircle, iconColor: STATUS_PALETTE.error.text },
};

const SEVERITY_TOKEN_KEY: Record<string, keyof typeof STATUS_PALETTE> = {
  info: 'info',
  warning: 'warning',
  critical: 'error',
};

const AUTO_DISMISS_MS = 8000;

function AlertToast({ alert, onDismiss }: { alert: FiredAlert; onDismiss: () => void }) {
  const { t } = useTranslation();
  const tokenKey = SEVERITY_TOKEN_KEY[alert.severity] ?? 'info';
  const token = STATUS_PALETTE[tokenKey];
  const { icon: Icon, iconColor } = SEVERITY_ICONS[alert.severity] ?? SEVERITY_ICONS.info!;

  // Keep the latest onDismiss in a ref so the auto-dismiss timer keys only on
  // the alert id. The container passes a fresh inline `() => dismissToast(id)`
  // each render, so depending on `onDismiss` restarted the 8s timer on every
  // re-render — under an alert storm the toast never dismissed.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => onDismissRef.current(), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [alert.id]);

  return (
    <div
      className={`animate-fade-slide-in pointer-events-auto w-80 rounded-modal border ${token.border} ${token.bg} backdrop-blur-sm shadow-elevation-3 p-3`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <p className="typo-heading text-foreground truncate">{alert.rule_name}</p>
          <p className="typo-caption text-foreground mt-0.5">{alert.message}</p>
        </div>
        {/* The icon is the entire button, so without a name this control is
            announced as "button" and is unusable by screen reader. Translated,
            not hardcoded: 116 hardcoded-English accessible names were measured
            in this tree and 81% of them are structurally invisible to
            `custom/no-hardcoded-jsx-text`, so a literal here would not be
            caught by anything. */}
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t.common.dismiss}
          className="p-0.5 text-foreground hover:text-muted-foreground transition-colors shrink-0"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export function AlertToastContainer() {
  const { activeToasts, dismissToast } = useOverviewStore(useShallow((s) => ({
    activeToasts: s.activeToasts,
    dismissToast: s.dismissToast,
  })));

  // The wrapper is rendered UNCONDITIONALLY, and that is the whole point.
  //
  // This file previously had zero roles and zero aria-* attributes — the
  // backend-alert stack, the purest "something changed without you acting"
  // surface in the app, was completely inaudible. The obvious repair is to add
  // aria-live to the element below, but doing that while keeping the
  // `if (activeToasts.length === 0) return null` early-return would fix
  // nothing: a live region that is MOUNTED HOLDING ITS OWN MESSAGE is not a
  // change, and screen readers stay silent for it. The region must already be
  // in the tree when the message arrives.
  //
  // That defect is the subject of
  // docs/concepts/golden-paths/screen-reader-announcements.md, which measured
  // 26 of 82 live regions in this repo making exactly that mistake — and found
  // it converges across sibling codebases (20/28 and 6/7) while the fix does
  // not. An always-mounted empty div costs nothing: it is pointer-events-none
  // and renders no box.
  //
  // `polite` rather than `assertive` deliberately: these are backend alerts,
  // and assertive interrupts whatever the user is currently reading.
  return (
    <div
      className="fixed top-4 right-4 z-[9990] flex flex-col gap-2 pointer-events-none"
      role="status"
      aria-live="polite"
    >
      {activeToasts.slice(0, 5).map((alert) => (
          <AlertToast key={alert.id} alert={alert} onDismiss={() => dismissToast(alert.id)} />
        ))}
    </div>
  );
}
