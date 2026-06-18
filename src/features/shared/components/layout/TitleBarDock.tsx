import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Bell, CalendarClock, ClipboardCheck, Search, BadgeCheck } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { ActivityPulseIcon } from '@/features/shared/components/icons/ActivityPulseIcon';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useTitleBarTray, TrayOverlays } from './useTitleBarTray';

/**
 * @catalog Title-bar quick-action dock — capsule tray (search / schedules / review / monitor / notifications) with inline counts and keyboard-nav key hints.
 *
 * The title bar's quick-action tray. Counts are first-class data, not
 * stickers: every signal renders INLINE beside its glyph inside a capsule
 * button (icon + number side by side), so a number never overlaps an icon and
 * every count shares one size/weight/position. Urgency is carried by semantic
 * colour alone: info (scheduled), warning (needs you), primary (news). The
 * whole tray sits in one containment ring so the five actions read as a
 * single instrument.
 *
 * Keyboard: while `;` keyboard-nav mode is active (see `KeyboardNavMode`),
 * each capsule shows its key on a hint chip below the bar and S / C / R / M /
 * N toggle the matching surface. Surface keys keep the mode armed — it stays
 * on until `;` / Esc / the footer switch. The keys do nothing outside nav mode.
 */
export default function TitleBarDock() {
  const { t, tx } = useTranslation();
  const tray = useTitleBarTray();
  const prefersReducedMotion = useReducedMotion();
  const keyboardNavActive = useSystemStore((s) => s.keyboardNavActive);

  useAppKeyboard(
    (e) => {
      if (!keyboardNavActive) return false;
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (isTypingTarget(e.target)) return false;
      switch (e.key.toLowerCase()) {
        case 's':
          e.preventDefault();
          tray.openSearch();
          // Stay armed after opening search: the mode now persists until the
          // user switches it off (`;` / Esc / footer switch), not per-shortcut.
          return true;
        case 'c':
          e.preventDefault();
          tray.toggleSchedules();
          return true;
        case 'r':
          e.preventDefault();
          tray.toggleReview();
          return true;
        case 'm':
          e.preventDefault();
          tray.toggleMonitor();
          return true;
        case 'n':
          e.preventDefault();
          tray.toggleNotifications();
          return true;
        case 'g':
          e.preventDefault();
          tray.openAcceptance();
          return true;
        default:
          return false;
      }
    },
    // Below KeyboardNavMode (30) — it owns `;`/Esc/ArrowLeft and passes
    // everything else through; above the cheat-sheet (20).
    { priority: 29 },
  );

  return (
    <>
      <div className="titlebar-nodrag mr-2 flex h-8 items-center gap-0.5 rounded-full border border-primary/10 bg-secondary/40 px-1">
        <DockAction
          onClick={tray.openSearch}
          label={t.settings.search.trigger_aria}
          title={t.settings.search.trigger_hint}
          testId="titlebar-search"
          hintKey="S"
          showHint={keyboardNavActive}
        >
          <Search size={17} strokeWidth={1.6} />
        </DockAction>

        <DockAction
          onClick={tray.toggleSchedules}
          active={tray.isScheduleActive}
          count={tray.todayScheduleCount}
          countClass="text-status-info"
          label={tray.todayScheduleCount > 0 ? tx(t.chrome.tray_schedules_today, { count: tray.todayScheduleCount }) : t.chrome.tray_schedules}
          title={tray.todayScheduleCount > 0 ? tx(t.chrome.tray_schedules_today, { count: tray.todayScheduleCount }) : t.chrome.tray_schedules}
          testId="titlebar-schedules"
          hintKey="C"
          showHint={keyboardNavActive}
        >
          <CalendarClock size={17} strokeWidth={1.6} />
        </DockAction>

        <DockAction
          onClick={tray.toggleReview}
          active={tray.reviewOpen}
          count={tray.quickCount}
          countClass="text-status-warning"
          label={tray.quickCount > 0 ? tx(t.monitor.review_titlebar_attention, { count: tray.quickCount }) : t.monitor.review_titlebar}
          title={tray.quickCount > 0 ? tx(t.monitor.review_titlebar_attention, { count: tray.quickCount }) : t.monitor.review_titlebar}
          testId="titlebar-human-review"
          hintKey="R"
          showHint={keyboardNavActive}
          quickAnswerTrigger
        >
          <ClipboardCheck width={17} height={17} strokeWidth={1.6} />
        </DockAction>

        <DockAction
          onClick={tray.openAcceptance}
          active={tray.acceptanceOpen}
          count={tray.pendingAcceptance}
          countClass="text-status-warning"
          label={tray.pendingAcceptance > 0 ? tx(t.chrome.tray_acceptance_pending, { count: tray.pendingAcceptance }) : t.chrome.tray_acceptance}
          title={tray.pendingAcceptance > 0 ? tx(t.chrome.tray_acceptance_pending, { count: tray.pendingAcceptance }) : t.chrome.tray_acceptance}
          testId="titlebar-goal-acceptance"
          hintKey="G"
          showHint={keyboardNavActive}
        >
          <BadgeCheck size={17} strokeWidth={1.6} />
        </DockAction>

        <DockAction
          onClick={tray.toggleMonitor}
          active={tray.monitorOpen}
          count={tray.monitorAttention}
          countClass="text-status-warning"
          label={tray.monitorAttention > 0 ? tx(t.monitor.titlebar_attention, { count: tray.monitorAttention }) : t.monitor.titlebar}
          title={tray.monitorAttention > 0 ? tx(t.monitor.titlebar_tooltip, { count: tray.monitorAttention }) : t.monitor.titlebar}
          testId="titlebar-process-activity"
          hintKey="M"
          showHint={keyboardNavActive}
        >
          {tray.running && (
            prefersReducedMotion ? (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-1 rounded-full border border-primary/50 opacity-50"
              />
            ) : (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute inset-1 rounded-full border border-primary/50"
                animate={{ opacity: [0.15, 0.6, 0.15] }}
                transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
              />
            )
          )}
          <ActivityPulseIcon
            width={17}
            height={17}
            strokeWidth={1.6}
            className={tray.running ? 'text-primary' : undefined}
          />
        </DockAction>

        <DockAction
          onClick={tray.toggleNotifications}
          active={tray.notificationsOpen}
          count={tray.unreadCount}
          countClass="text-primary"
          label={tray.unreadCount > 0 ? tx(t.chrome.tray_notifications_unread, { count: tray.unreadCount }) : t.chrome.tray_notifications}
          title={tray.unreadCount > 0 ? tx(t.chrome.tray_notifications_unread, { count: tray.unreadCount }) : t.chrome.tray_notifications}
          testId="titlebar-notifications"
          hintKey="N"
          showHint={keyboardNavActive}
        >
          <Bell size={17} strokeWidth={1.6} />
        </DockAction>
      </div>
      <TrayOverlays />
    </>
  );
}

interface DockActionProps {
  children: ReactNode;
  onClick: () => void;
  label: string;
  title: string;
  testId: string;
  count?: number;
  countClass?: string;
  active?: boolean;
  quickAnswerTrigger?: boolean;
  /** Key chip shown under the capsule while keyboard-nav mode is active. */
  hintKey?: string;
  showHint?: boolean;
}

function DockAction({
  children,
  onClick,
  label,
  title,
  testId,
  count = 0,
  countClass,
  active,
  quickAnswerTrigger,
  hintKey,
  showHint,
}: DockActionProps) {
  return (
    <button
      type="button"
      className={`relative inline-flex h-7 items-center gap-1.5 rounded-full px-2 transition-colors ${
        active
          ? 'bg-primary/15 text-primary'
          : 'text-muted-foreground hover:bg-primary/10 hover:text-foreground'
      }`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={title}
      data-testid={testId}
      {...(quickAnswerTrigger ? { 'data-quick-answer-trigger': true } : {})}
    >
      {children}
      {count > 0 && (
        <span className={`text-xs font-semibold leading-none tabular-nums ${countClass ?? ''}`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {hintKey && showHint && (
        <kbd
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-full mt-1.5 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-input border border-primary/20 bg-background text-xs font-semibold text-foreground shadow-elevation-2"
        >
          {hintKey}
        </kbd>
      )}
    </button>
  );
}
