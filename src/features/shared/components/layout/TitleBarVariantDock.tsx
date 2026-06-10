import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Bell, CalendarClock, ClipboardCheck, Search } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { ActivityPulseIcon } from '@/features/shared/components/icons/ActivityPulseIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { useTitleBarTray, TrayOverlays } from './useTitleBarTray';

/**
 * PROTOTYPE VARIANT — "Dock".
 *
 * Metaphor: counts are first-class data, not stickers. Every signal renders
 * INLINE beside its glyph inside a capsule button (icon + number side by
 * side), so a number never overlaps an icon and every count shares one
 * size/weight/position. Urgency is carried by semantic colour alone:
 * info (scheduled), warning (needs you), primary (news). The whole tray sits
 * in one containment ring so the five actions read as a single instrument,
 * not five floating glyphs.
 */
export default function TitleBarVariantDock() {
  const { t, tx } = useTranslation();
  const tray = useTitleBarTray();
  const prefersReducedMotion = useReducedMotion();

  return (
    <>
      <div className="titlebar-nodrag mr-2 flex h-8 items-center gap-0.5 rounded-full border border-primary/10 bg-secondary/40 px-1">
        <DockAction
          onClick={tray.openSearch}
          label={t.settings.search.trigger_aria}
          title={t.settings.search.trigger_hint}
          testId="titlebar-search"
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
          quickAnswerTrigger
        >
          <ClipboardCheck width={17} height={17} strokeWidth={1.6} />
        </DockAction>

        <DockAction
          onClick={tray.toggleMonitor}
          active={tray.monitorOpen}
          count={tray.monitorAttention}
          countClass="text-status-warning"
          label={tray.monitorAttention > 0 ? tx(t.monitor.titlebar_attention, { count: tray.monitorAttention }) : t.monitor.titlebar}
          title={tray.monitorAttention > 0 ? tx(t.monitor.titlebar_tooltip, { count: tray.monitorAttention }) : t.monitor.titlebar}
          testId="titlebar-process-activity"
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
    </button>
  );
}
