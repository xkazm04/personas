import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Bell, CalendarClock, ClipboardCheck, Search } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useAppKeyboard } from '@/lib/keyboard/AppKeyboardProvider';
import { isTypingTarget } from '@/lib/keyboard/KeyboardNavMode';
import { ActivityPulseIcon } from '@/features/shared/components/icons/ActivityPulseIcon';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useSystemStore } from '@/stores/systemStore';
import { useTranslation } from '@/i18n/useTranslation';
import { useTitleBarTray, TrayOverlays } from '@/features/shared/chrome/useTitleBarTray';

const ICON_SIZE = 21;

/**
 * @catalog Title-bar quick-action dock — key strip (search / schedules / review / monitor / notifications) with inline counts and keyboard-nav key hints.
 *
 * The title bar's quick-action tray. Counts are first-class data, not
 * stickers: every signal renders INLINE beside its glyph inside a 36px
 * key (icon + number side by side), so a number never overlaps an icon and
 * every count shares one size/weight/position. Urgency is carried by semantic
 * colour alone: info (scheduled), warning (needs you), primary (news). The
 * whole tray sits in one containment ring so the actions read as a
 * single instrument.
 *
 * Keyboard: while `;` keyboard-nav mode is active (see `KeyboardNavMode`),
 * each capsule shows its key on a hint chip below the bar and S / T / R / M /
 * N toggle the matching surface. Surface keys keep the mode armed — it
 * stays on until `;` / Esc / the footer switch. The keys do nothing outside
 * nav mode.
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
        case 't':
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
        default:
          return false;
      }
    },
    // Below KeyboardNavMode (30) — it owns `;`/Esc/ArrowLeft and passes
    // everything else through; above the cheat-sheet (20).
    { priority: 29 },
  );

  const icon = ICON_SIZE;
  const common = { showHint: keyboardNavActive };

  const search = (
    <DockAction {...common} onClick={tray.openSearch} label={t.settings.search.trigger_aria} title={t.settings.search.trigger_hint} testId="titlebar-search" hintKey="S">
      <Search size={icon} strokeWidth={1.6} />
    </DockAction>
  );
  const schedules = (
    <DockAction
      {...common}
      onClick={tray.toggleSchedules}
      active={tray.isScheduleActive}
      count={tray.todayScheduleCount}
      countClass="text-status-info"
      label={tray.todayScheduleCount > 0 ? tx(t.chrome.tray_schedules_today, { count: tray.todayScheduleCount }) : t.chrome.tray_schedules}
      title={tray.todayScheduleCount > 0 ? tx(t.chrome.tray_schedules_today, { count: tray.todayScheduleCount }) : t.chrome.tray_schedules}
      testId="titlebar-schedules"
      hintKey="T"
    >
      <CalendarClock size={icon} strokeWidth={1.6} />
    </DockAction>
  );
  const review = (
    <DockAction
      {...common}
      onClick={tray.toggleReview}
      active={tray.reviewOpen}
      count={tray.quickCount}
      countClass="text-status-warning"
      label={tray.quickCount > 0 ? tx(t.monitor.review_titlebar_attention, { count: tray.quickCount }) : t.monitor.review_titlebar}
      title={tray.quickCount > 0 ? tx(t.monitor.review_titlebar_attention, { count: tray.quickCount }) : t.monitor.review_titlebar}
      testId="titlebar-human-review"
      hintKey="R"
      quickAnswerTrigger
    >
      <ClipboardCheck width={icon} height={icon} strokeWidth={1.6} />
    </DockAction>
  );
  const monitor = (
    <DockAction
      {...common}
      onClick={tray.toggleMonitor}
      active={tray.monitorOpen}
      count={tray.monitorAttention}
      countClass="text-status-warning"
      label={tray.monitorAttention > 0 ? tx(t.monitor.titlebar_attention, { count: tray.monitorAttention }) : t.monitor.titlebar}
      title={tray.monitorAttention > 0 ? tx(t.monitor.titlebar_tooltip, { count: tray.monitorAttention }) : t.monitor.titlebar}
      testId="titlebar-process-activity"
      hintKey="M"
    >
      {tray.running && (
        prefersReducedMotion ? (
          <span aria-hidden className={`pointer-events-none absolute inset-1 rounded-xl border border-primary/50 opacity-50`} />
        ) : (
          <motion.span
            aria-hidden
            className={`pointer-events-none absolute inset-1 rounded-xl border border-primary/50`}
            animate={{ opacity: [0.15, 0.6, 0.15] }}
            transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
          />
        )
      )}
      <ActivityPulseIcon width={icon} height={icon} strokeWidth={1.6} className={tray.running ? 'text-primary' : undefined} />
    </DockAction>
  );
  const notifications = (
    <DockAction
      {...common}
      onClick={tray.toggleNotifications}
      active={tray.notificationsOpen}
      count={tray.unreadCount}
      countClass="text-primary"
      label={tray.unreadCount > 0 ? tx(t.chrome.tray_notifications_unread, { count: tray.unreadCount }) : t.chrome.tray_notifications}
      title={tray.unreadCount > 0 ? tx(t.chrome.tray_notifications_unread, { count: tray.unreadCount }) : t.chrome.tray_notifications}
      testId="titlebar-notifications"
      hintKey="N"
    >
      <Bell size={icon} strokeWidth={1.6} />
    </DockAction>
  );
  return (
    <>
      <div className="titlebar-nodrag mr-2 flex h-10 items-center gap-0.5 rounded-2xl border border-primary/15 bg-gradient-to-b from-secondary/60 to-secondary/25 px-1 shadow-elevation-1">
        {search}
        <DockDivider />
        {schedules}{review}
        <DockDivider />
        {monitor}{notifications}
      </div>
      <TrayOverlays />
    </>
  );
}

function DockDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-primary/15" />;
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

// 36px key; grows with px when a count sits beside the glyph. Active state
// adds an underline bar so the "selected" key reads at a glance.
const ACTION_BASE = 'relative inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-xl px-2 transition-colors after:pointer-events-none after:absolute after:inset-x-2.5 after:bottom-0.5 after:h-0.5 after:rounded-full after:bg-primary after:transition-opacity';
const ACTION_ACTIVE = 'bg-primary/15 text-primary after:opacity-100';
const ACTION_IDLE = 'text-muted-foreground hover:bg-primary/10 hover:text-foreground after:opacity-0';

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
  const countEl = count > 0 && (
    <span className={`typo-caption font-semibold leading-none tabular-nums ${countClass ?? ''}`}>
      {count > 99 ? '99+' : count}
    </span>
  );
  return (
    <Tooltip content={title} placement="bottom">
      <button
        type="button"
        className={`${ACTION_BASE} ${active ? ACTION_ACTIVE : ACTION_IDLE}`}
        onClick={onClick}
        aria-pressed={active}
        aria-label={label}
        data-testid={testId}
        {...(quickAnswerTrigger ? { 'data-quick-answer-trigger': true } : {})}
      >
        {children}
        {countEl}
        {hintKey && showHint && (
          <kbd
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-full mt-1.5 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-input border border-primary/20 bg-background typo-caption font-semibold text-foreground shadow-elevation-2"
          >
            {hintKey}
          </kbd>
        )}
      </button>
    </Tooltip>
  );
}
