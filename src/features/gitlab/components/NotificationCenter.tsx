import { useCallback } from 'react';
import { Bell, BellOff, X, ExternalLink, RefreshCw, FileText, CheckCheck, Trash2, ClipboardCheck, ArrowRight } from 'lucide-react';
import { useNotificationCenterStore, type PipelineNotification, type ProcessType } from '@/stores/notificationCenterStore';
import { useSystemStore } from '@/stores/systemStore';
import { sanitizeExternalUrl } from '@/lib/utils/sanitizers/sanitizeUrl';
import { StatusIcon, statusBg } from './pipelineHelpers';
import { useTranslation } from '@/i18n/useTranslation';
import { getProcessLabel } from '@/lib/notifications/notifyProcessComplete';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

function statusLabel(status: string): string {
  switch (status) {
    case 'success': return 'Succeeded';
    case 'failed': return 'Failed';
    case 'canceled': return 'Canceled';
    case 'warning': return 'Completed with warning';
    default: return status;
  }
}

/** Process notifications use pipelineId === 0 and encode processType in ref. */
function isProcessNotification(n: PipelineNotification): boolean {
  return n.pipelineId === 0 && n.id.startsWith('proc-');
}

// ---------------------------------------------------------------------------
// ProcessNotificationItem (human reviews, execution results, etc.)
// ---------------------------------------------------------------------------

function ProcessNotificationItem({ notification }: { notification: PipelineNotification }) {
  const { t } = useTranslation();
  const markRead = useNotificationCenterStore((s) => s.markRead);
  const dismiss = useNotificationCenterStore((s) => s.dismiss);
  const setOpen = useNotificationCenterStore((s) => s.setOpen);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  const setPluginTab = useSystemStore((s) => s.setPluginTab);
  const setDevToolsTab = useSystemStore((s) => s.setDevToolsTab);

  const processType = notification.ref as ProcessType;
  const processLabel = getProcessLabel(processType, t);

  // Parse redirect from webUrl (format: "section#tab" or just "section")
  const [redirectSection, redirectTab] = notification.webUrl.includes('#')
    ? notification.webUrl.split('#', 2)
    : [notification.webUrl, null];
  const hasReviewRedirect = redirectTab === 'manual-review';

  const handleRedirect = useCallback(() => {
    markRead(notification.id);
    setOpen(false);
    // Navigate to the target section and tab
    setSidebarSection(redirectSection as Parameters<typeof setSidebarSection>[0]);
    if (redirectTab) {
      // Plugins section uses devToolsTab; overview section uses overviewTab.
      if (redirectSection === 'plugins') {
        setPluginTab('dev-tools' as never);
        setDevToolsTab(redirectTab as never);
      } else {
        void import('@/stores/overviewStore').then(({ useOverviewStore }) => {
          useOverviewStore.getState().setOverviewTab(redirectTab as never);
        });
      }
    }
  }, [notification.id, markRead, setOpen, setSidebarSection, setPluginTab, setDevToolsTab, redirectSection, redirectTab]);

  const handleClick = useCallback(() => {
    if (!notification.read) markRead(notification.id);
  }, [notification, markRead]);

  // Compose body lines: prefer message if present, fall back to status label.
  const headerTitle = notification.title ?? (hasReviewRedirect ? t.gitlab.human_review : processLabel);
  const bodyText = notification.message ?? statusLabel(notification.status);

  return (
    <div
      onClick={handleClick}
      className={`animate-fade-slide-in relative group p-3 rounded-xl border transition-colors cursor-default ${statusBg(notification.status)} ${
        !notification.read ? 'ring-1 ring-orange-500/20' : ''
      }`}
    >
      {!notification.read && (
        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-orange-500" />
      )}

      <button
        onClick={(e) => { e.stopPropagation(); dismiss(notification.id); }}
        className="absolute top-2 right-2 p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/10 text-muted-foreground/50 hover:text-foreground/70 transition-all"
        aria-label="Dismiss"
      >
        <X className="w-3 h-3" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        {hasReviewRedirect
          ? <ClipboardCheck className="w-4 h-4 text-amber-400" />
          : <StatusIcon status={notification.status} />
        }
        <span className="text-sm font-medium text-foreground/90">
          {headerTitle}
        </span>
        <span className="text-xs text-muted-foreground/50 ml-auto mr-4">
          {formatTimestamp(notification.timestamp)}
        </span>
      </div>

      {/* Body — show stored message or fall back to status label */}
      <p className="text-xs text-muted-foreground/70 mb-2.5 pl-6 leading-relaxed">
        {bodyText}
      </p>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 pl-6">
        {redirectSection && (
          <button
            onClick={(e) => { e.stopPropagation(); handleRedirect(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground/70 hover:text-foreground/90 hover:bg-primary/10 transition-colors"
            title={hasReviewRedirect ? t.gitlab.go_to_approvals : processLabel}
          >
            <ArrowRight className="w-3 h-3" />
            {hasReviewRedirect ? 'Review' : 'Open'}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationItem (pipeline / GitLab notifications)
// ---------------------------------------------------------------------------

function NotificationItem({ notification }: { notification: PipelineNotification }) {
  const { t } = useTranslation();
  const markRead = useNotificationCenterStore((s) => s.markRead);
  const dismiss = useNotificationCenterStore((s) => s.dismiss);
  const setOpen = useNotificationCenterStore((s) => s.setOpen);

  const triggerPipeline = useSystemStore((s) => s.gitlabTriggerPipelineAction);

  const handleViewInGitLab = useCallback(() => {
    const url = sanitizeExternalUrl(notification.webUrl);
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    markRead(notification.id);
  }, [notification, markRead]);

  const handleRetry = useCallback(() => {
    if (notification.projectId) {
      triggerPipeline(notification.projectId, notification.ref);
      setOpen(false);
    }
  }, [notification, triggerPipeline, setOpen]);

  const handleClick = useCallback(() => {
    if (!notification.read) markRead(notification.id);
  }, [notification, markRead]);

  return (
    <div
      onClick={handleClick}
      className={`animate-fade-slide-in relative group p-3 rounded-xl border transition-colors cursor-default ${statusBg(notification.status)} ${
        !notification.read ? 'ring-1 ring-orange-500/20' : ''
      }`}
    >
      {/* Unread indicator */}
      {!notification.read && (
        <span className="absolute top-3 right-3 w-2 h-2 rounded-full bg-orange-500" />
      )}

      {/* Dismiss button */}
      <button
        onClick={(e) => { e.stopPropagation(); dismiss(notification.id); }}
        className="absolute top-2 right-2 p-1 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-primary/10 text-muted-foreground/50 hover:text-foreground/70 transition-all"
        aria-label="Dismiss"
      >
        <X className="w-3 h-3" />
      </button>

      {/* Header */}
      <div className="flex items-center gap-2 mb-1.5">
        <StatusIcon status={notification.status} />
        <span className="text-sm font-medium text-foreground/90">
          Pipeline #{notification.pipelineId}
        </span>
        <span className="text-xs text-muted-foreground/50 ml-auto mr-4">
          {formatTimestamp(notification.timestamp)}
        </span>
      </div>

      {/* Body */}
      <p className="text-xs text-muted-foreground/70 mb-2.5 pl-6">
        <span className="font-mono text-foreground/60">{notification.ref}</span>
        {' '}&mdash;{' '}{statusLabel(notification.status)}
      </p>

      {/* Quick actions */}
      <div className="flex items-center gap-1.5 pl-6">
        {notification.webUrl && (
          <button
            onClick={(e) => { e.stopPropagation(); handleViewInGitLab(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground/70 hover:text-foreground/90 hover:bg-primary/10 transition-colors"
            title={t.gitlab.open_in_gitlab}
          >
            <ExternalLink className="w-3 h-3" />
            GitLab
          </button>
        )}
        {notification.status === 'failed' && notification.projectId && (
          <button
            onClick={(e) => { e.stopPropagation(); handleRetry(); }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground/70 hover:text-foreground/90 hover:bg-primary/10 transition-colors"
            title={t.common.retry}
          >
            <RefreshCw className="w-3 h-3" />
            {t.common.retry}
          </button>
        )}
        {notification.webUrl && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              const url = sanitizeExternalUrl(notification.webUrl);
              if (url) {
                // Navigate to jobs page (append /jobs to pipeline URL)
                window.open(`${url}/jobs`, '_blank', 'noopener,noreferrer');
              }
              markRead(notification.id);
            }}
            className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-muted-foreground/70 hover:text-foreground/90 hover:bg-primary/10 transition-colors"
            title={t.gitlab.view_logs}
          >
            <FileText className="w-3 h-3" />
            {t.gitlab.view_logs}
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// NotificationCenter
// ---------------------------------------------------------------------------

export function NotificationCenter() {
  const { t } = useTranslation();
  const isOpen = useNotificationCenterStore((s) => s.isOpen);
  const setOpen = useNotificationCenterStore((s) => s.setOpen);
  const notifications = useNotificationCenterStore((s) => s.notifications);
  const unreadCount = useNotificationCenterStore((s) => s.unreadCount);
  const markAllRead = useNotificationCenterStore((s) => s.markAllRead);
  const clearAll = useNotificationCenterStore((s) => s.clearAll);

  return (
    <>
    {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="animate-fade-slide-in fixed inset-0 z-[90] bg-black/30 backdrop-blur-[2px]"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div
            className="animate-fade-in fixed top-0 right-0 bottom-0 z-[91] w-[380px] max-w-[90vw] bg-background border-l border-primary/15 shadow-elevation-4 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-primary/10">
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-orange-400" />
                <h2 className="text-sm font-semibold text-foreground/90">{t.gitlab.notifications}</h2>
                {unreadCount > 0 && (
                  <span className="min-w-[18px] h-[18px] px-1 flex items-center justify-center text-[10px] font-bold rounded-full bg-orange-500 text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
                    title={t.gitlab.mark_all_read}
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={clearAll}
                    className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
                    title={t.gitlab.clear_all}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={() => setOpen(false)}
                  className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/50 hover:text-foreground/70 transition-colors"
                  aria-label={t.gitlab.close_notification_center}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto scrollbar-thin px-3 py-3 space-y-2">
              {notifications.length === 0 ? (
                  <div
                    key="empty"
                    className="animate-fade-slide-in flex flex-col items-center justify-center py-16 text-center"
                  >
                    <div className="w-14 h-14 rounded-2xl bg-secondary/40 border border-primary/10 flex items-center justify-center mb-4">
                      <BellOff className="w-7 h-7 text-muted-foreground/30" />
                    </div>
                    <p className="text-lg text-muted-foreground font-medium">{t.gitlab.no_notifications_yet}</p>
                    <p className="text-md text-muted-foreground mt-1 max-w-[220px]">
                      {t.gitlab.pipeline_status_hint}
                    </p>
                  </div>
                ) : (
                  notifications.map((n) =>
                    isProcessNotification(n)
                      ? <ProcessNotificationItem key={n.id} notification={n} />
                      : <NotificationItem key={n.id} notification={n} />,
                  )
                )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
