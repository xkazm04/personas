import { Fragment, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import { Bell, CalendarClock, ClipboardCheck, Search } from 'lucide-react';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { ActivityPulseIcon } from '@/features/shared/components/icons/ActivityPulseIcon';
import { useTranslation } from '@/i18n/useTranslation';
import { useTitleBarTray, TrayOverlays } from './useTitleBarTray';

/**
 * PROTOTYPE VARIANT — "Ledger".
 *
 * Metaphor: an instrument cluster. Controls and signals are SEPARATED —
 * the five action buttons stay pure, evenly sized glyphs (never badged),
 * while every non-zero count moves into one annunciator strip to their left:
 * "2 today · 3 to answer · 5 unread" as readable, clickable micro-chips that
 * jump straight to their surface. A 6px corner dot on an icon mirrors "this
 * control has a signal". When everything is zero the strip vanishes and the
 * title bar is perfectly calm.
 */
export default function TitleBarVariantLedger() {
  const { t, tx } = useTranslation();
  const tray = useTitleBarTray();
  const prefersReducedMotion = useReducedMotion();

  const chips: ReactNode[] = [];

  if (tray.running) {
    chips.push(
      <LedgerChip
        key="running"
        onClick={tray.toggleMonitor}
        label={t.monitor.titlebar}
        word={t.chrome.tray_word_running}
        wordClass="text-primary"
      >
        {prefersReducedMotion ? (
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary" />
        ) : (
          <motion.span
            aria-hidden
            className="h-1.5 w-1.5 rounded-full bg-primary"
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
          />
        )}
      </LedgerChip>,
    );
  }
  if (tray.quickCount > 0) {
    chips.push(
      <LedgerChip
        key="review"
        onClick={tray.toggleReview}
        label={tx(t.monitor.review_titlebar_attention, { count: tray.quickCount })}
        count={tray.quickCount}
        countClass="text-status-warning"
        word={t.chrome.tray_word_to_answer}
        quickAnswerTrigger
      >
        <ClipboardCheck width={13} height={13} strokeWidth={1.8} className="text-status-warning" />
      </LedgerChip>,
    );
  }
  if (tray.monitorAttention > 0) {
    chips.push(
      <LedgerChip
        key="fleet"
        onClick={tray.toggleMonitor}
        label={tx(t.monitor.titlebar_attention, { count: tray.monitorAttention })}
        count={tray.monitorAttention}
        countClass="text-status-warning"
        word={t.chrome.tray_word_fleet}
      >
        <ActivityPulseIcon width={13} height={13} strokeWidth={1.8} className="text-status-warning" />
      </LedgerChip>,
    );
  }
  if (tray.todayScheduleCount > 0) {
    chips.push(
      <LedgerChip
        key="today"
        onClick={tray.toggleSchedules}
        label={tx(t.chrome.tray_schedules_today, { count: tray.todayScheduleCount })}
        count={tray.todayScheduleCount}
        countClass="text-status-info"
        word={t.chrome.tray_word_today}
      >
        <CalendarClock size={13} strokeWidth={1.8} className="text-status-info" />
      </LedgerChip>,
    );
  }
  if (tray.unreadCount > 0) {
    chips.push(
      <LedgerChip
        key="unread"
        onClick={tray.toggleNotifications}
        label={tx(t.chrome.tray_notifications_unread, { count: tray.unreadCount })}
        count={tray.unreadCount}
        countClass="text-primary"
        word={t.chrome.tray_word_unread}
      >
        <Bell size={13} strokeWidth={1.8} className="text-primary" />
      </LedgerChip>,
    );
  }

  return (
    <>
      {chips.length > 0 && (
        <div
          role="group"
          aria-label={t.chrome.tray_signals}
          className="titlebar-nodrag mr-2 flex h-7 items-center rounded-full border border-primary/10 bg-secondary/30 px-1"
        >
          {chips.map((chip, i) => (
            <Fragment key={i}>
              {i > 0 && <span aria-hidden className="mx-0.5 h-3.5 w-px bg-primary/10" />}
              {chip}
            </Fragment>
          ))}
        </div>
      )}

      <div className="mr-1 flex items-center">
        <LedgerButton
          onClick={tray.openSearch}
          label={t.settings.search.trigger_aria}
          title={t.settings.search.trigger_hint}
          testId="titlebar-search"
        >
          <Search size={20} strokeWidth={1.5} />
        </LedgerButton>

        <LedgerButton
          onClick={tray.toggleSchedules}
          active={tray.isScheduleActive}
          dotClass={tray.todayScheduleCount > 0 ? 'bg-status-info' : undefined}
          label={tray.todayScheduleCount > 0 ? tx(t.chrome.tray_schedules_today, { count: tray.todayScheduleCount }) : t.chrome.tray_schedules}
          title={tray.todayScheduleCount > 0 ? tx(t.chrome.tray_schedules_today, { count: tray.todayScheduleCount }) : t.chrome.tray_schedules}
          testId="titlebar-schedules"
        >
          <CalendarClock size={20} strokeWidth={1.5} />
        </LedgerButton>

        <LedgerButton
          onClick={tray.toggleReview}
          active={tray.reviewOpen}
          dotClass={tray.quickCount > 0 ? 'bg-status-warning' : undefined}
          label={tray.quickCount > 0 ? tx(t.monitor.review_titlebar_attention, { count: tray.quickCount }) : t.monitor.review_titlebar}
          title={tray.quickCount > 0 ? tx(t.monitor.review_titlebar_attention, { count: tray.quickCount }) : t.monitor.review_titlebar}
          testId="titlebar-human-review"
          quickAnswerTrigger
        >
          <ClipboardCheck width={20} height={20} strokeWidth={1.5} />
        </LedgerButton>

        <LedgerButton
          onClick={tray.toggleMonitor}
          active={tray.monitorOpen}
          dotClass={tray.monitorAttention > 0 ? 'bg-status-warning' : undefined}
          label={tray.monitorAttention > 0 ? tx(t.monitor.titlebar_attention, { count: tray.monitorAttention }) : t.monitor.titlebar}
          title={tray.monitorAttention > 0 ? tx(t.monitor.titlebar_tooltip, { count: tray.monitorAttention }) : t.monitor.titlebar}
          testId="titlebar-process-activity"
        >
          <ActivityPulseIcon
            width={20}
            height={20}
            strokeWidth={1.5}
            className={tray.running ? 'text-primary' : undefined}
          />
        </LedgerButton>

        <LedgerButton
          onClick={tray.toggleNotifications}
          active={tray.notificationsOpen}
          dotClass={tray.unreadCount > 0 ? 'bg-primary' : undefined}
          label={tray.unreadCount > 0 ? tx(t.chrome.tray_notifications_unread, { count: tray.unreadCount }) : t.chrome.tray_notifications}
          title={tray.unreadCount > 0 ? tx(t.chrome.tray_notifications_unread, { count: tray.unreadCount }) : t.chrome.tray_notifications}
          testId="titlebar-notifications"
        >
          <Bell size={20} strokeWidth={1.5} />
        </LedgerButton>
      </div>
      <TrayOverlays />
    </>
  );
}

interface LedgerChipProps {
  children: ReactNode;
  onClick: () => void;
  label: string;
  word: string;
  count?: number;
  countClass?: string;
  wordClass?: string;
  quickAnswerTrigger?: boolean;
}

function LedgerChip({
  children,
  onClick,
  label,
  word,
  count,
  countClass,
  wordClass,
  quickAnswerTrigger,
}: LedgerChipProps) {
  return (
    <button
      type="button"
      className="flex h-6 items-center gap-1.5 rounded-full px-2 transition-colors hover:bg-primary/10"
      onClick={onClick}
      aria-label={label}
      title={label}
      {...(quickAnswerTrigger ? { 'data-quick-answer-trigger': true } : {})}
    >
      {children}
      <span className="text-xs leading-none whitespace-nowrap">
        {count !== undefined && (
          <>
            <span className={`font-semibold tabular-nums ${countClass ?? ''}`}>{count > 99 ? '99+' : count}</span>{' '}
          </>
        )}
        <span className={wordClass ?? 'text-muted-foreground'}>{word}</span>
      </span>
    </button>
  );
}

interface LedgerButtonProps {
  children: ReactNode;
  onClick: () => void;
  label: string;
  title: string;
  testId: string;
  active?: boolean;
  dotClass?: string;
  quickAnswerTrigger?: boolean;
}

function LedgerButton({
  children,
  onClick,
  label,
  title,
  testId,
  active,
  dotClass,
  quickAnswerTrigger,
}: LedgerButtonProps) {
  return (
    <button
      type="button"
      className={`titlebar-btn relative ${active ? 'titlebar-btn-active' : ''}`}
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={title}
      data-testid={testId}
      {...(quickAnswerTrigger ? { 'data-quick-answer-trigger': true } : {})}
    >
      {children}
      {dotClass && (
        <span aria-hidden className={`absolute right-[14px] top-[12px] h-1.5 w-1.5 rounded-full ${dotClass}`} />
      )}
    </button>
  );
}
