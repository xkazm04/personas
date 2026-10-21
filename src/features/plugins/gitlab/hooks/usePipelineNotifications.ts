import { useEffect, useRef } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { GitLabPipeline } from '@/lib/bindings/GitLabPipeline';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';
import { silentCatch } from '@/lib/silentCatch';
import { useTranslation, interpolate as tx } from '@/i18n/useTranslation';


// ---------------------------------------------------------------------------
// Notification preferences (persisted in localStorage)
// ---------------------------------------------------------------------------

const PREFS_KEY = 'gitlab_pipeline_notification_prefs';

export interface PipelineNotificationPrefs {
  enabled: boolean;
  onSuccess: boolean;
  onFailed: boolean;
  onCanceled: boolean;
  sound: boolean;
}

const DEFAULT_PREFS: PipelineNotificationPrefs = {
  enabled: true,
  onSuccess: true,
  onFailed: true,
  onCanceled: true,
  sound: false,
};

export function loadPipelineNotificationPrefs(): PipelineNotificationPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePipelineNotificationPrefs(prefs: PipelineNotificationPrefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (err) { silentCatch("features/plugins/gitlab/hooks/usePipelineNotifications:catch1")(err); }
}

// ---------------------------------------------------------------------------
// Terminal statuses that trigger notifications
// ---------------------------------------------------------------------------

const ACTIVE_STATUSES = new Set(['running', 'pending', 'created', 'waiting_for_resource', 'preparing']);
const TERMINAL_STATUSES: Record<string, keyof Pick<PipelineNotificationPrefs, 'onSuccess' | 'onFailed' | 'onCanceled'>> = {
  success: 'onSuccess',
  failed: 'onFailed',
  canceled: 'onCanceled',
};

type GitLabCopy = ReturnType<typeof useTranslation>['t']['gitlab'];

/** OS-notification title for a terminal pipeline status, in the UI language. */
function notificationTitle(copy: GitLabCopy, status: string): string {
  switch (status) {
    case 'success': return copy.notify_title_success;
    case 'failed': return copy.notify_title_failed;
    case 'canceled': return copy.notify_title_canceled;
    default: return tx(copy.notify_title_other, { status });
  }
}

// ---------------------------------------------------------------------------
// Hook: watches pipeline list for status transitions
// ---------------------------------------------------------------------------

/**
 * Detects when a pipeline transitions from an active status (running/pending)
 * to a terminal status (success/failed/canceled) and sends a desktop
 * notification if the user's preferences allow it.
 *
 * Also records each notification to the in-app notification center history.
 *
 * Call this from the pipeline viewer — it passively observes the pipeline
 * array without introducing any additional polling.
 */
export function usePipelineNotifications(pipelines: GitLabPipeline[], projectId?: number | null): void {
  // Snapshot of previous pipeline statuses keyed by pipeline ID
  const prevStatusesRef = useRef<Map<number, string>>(new Map());
  const permissionCheckedRef = useRef(false);
  const permissionGrantedRef = useRef(false);
  // Read through a ref at send time so a language switch never re-runs the status-diff effect.
  const { t } = useTranslation();
  const copyRef = useRef(t.gitlab);
  copyRef.current = t.gitlab;

  // Check permission once on mount
  useEffect(() => {
    if (permissionCheckedRef.current) return;
    permissionCheckedRef.current = true;

    isPermissionGranted().then((granted) => {
      if (granted) {
        permissionGrantedRef.current = true;
      } else {
        requestPermission().then((perm) => {
          permissionGrantedRef.current = perm === 'granted';
        }).catch(silentCatch('usePipelineNotifications:requestPermission'));
      }
    }).catch(silentCatch('usePipelineNotifications:isPermissionGranted'));
  }, []);

  useEffect(() => {
    if (pipelines.length === 0) return;

    const prev = prevStatusesRef.current;
    const prefs = loadPipelineNotificationPrefs();

    // Skip notifications on the very first render (initial load)
    if (prev.size > 0 && prefs.enabled) {
      for (const pipeline of pipelines) {
        const oldStatus = prev.get(pipeline.id);
        if (!oldStatus) continue;

        // Only notify when transitioning FROM an active status TO a terminal status
        if (!ACTIVE_STATUSES.has(oldStatus)) continue;

        const prefKey = TERMINAL_STATUSES[pipeline.status];
        if (!prefKey) continue;
        if (!prefs[prefKey]) continue;

        // Record to in-app notification center (always, regardless of OS permission)
        useNotificationCenterStore.getState().addNotification({
          pipelineId: pipeline.id,
          projectId: projectId ?? null,
          status: pipeline.status as 'success' | 'failed' | 'canceled',
          ref: pipeline.ref,
          webUrl: pipeline.webUrl,
        });

        // Desktop notification (requires OS permission)
        if (permissionGrantedRef.current) {
          sendNotification({
            title: notificationTitle(copyRef.current, pipeline.status),
            body: tx(copyRef.current.notify_body, { id: pipeline.id, ref: pipeline.ref, status: pipeline.status }),
            sound: prefs.sound ? 'default' : undefined,
          });
        }
      }
    }

    // Update snapshot
    const next = new Map<number, string>();
    for (const p of pipelines) {
      next.set(p.id, p.status);
    }
    prevStatusesRef.current = next;
  }, [pipelines, projectId]);
}
