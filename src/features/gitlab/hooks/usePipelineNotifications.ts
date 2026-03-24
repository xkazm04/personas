import { useEffect, useRef } from 'react';
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import type { GitLabPipeline } from '@/lib/bindings/GitLabPipeline';
import { useNotificationCenterStore } from '@/stores/notificationCenterStore';

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
  } catch {
    // intentional: localStorage quota exceeded or unavailable
  }
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

function statusEmoji(status: string): string {
  switch (status) {
    case 'success': return 'Pipeline Succeeded';
    case 'failed': return 'Pipeline Failed';
    case 'canceled': return 'Pipeline Canceled';
    default: return `Pipeline ${status}`;
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
        }).catch(() => {});
      }
    }).catch(() => {});
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
            title: statusEmoji(pipeline.status),
            body: `Pipeline #${pipeline.id} on ${pipeline.ref} is now ${pipeline.status}`,
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
