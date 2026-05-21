import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useOverviewStore } from "@/stores/overviewStore";
import { useToastStore } from '@/stores/toastStore';

/**
 * HealingToast -- no longer renders its own UI.
 *
 * Listens for Tauri `healing-event` events and dispatches healing toasts
 * into the unified toast store, which renders them in the consolidated
 * ToastContainer (bottom-right).
 *
 * Also listens for `healing-issue-updated` events to selectively re-fetch
 * the affected issue instead of polling the full list.
 */

interface HealingEventPayload {
  issue_id: string;
  persona_id: string;
  execution_id: string;
  title: string;
  action: string;
  auto_fixed: boolean;
  severity: string;
  suggested_fix: string | null;
  persona_name: string;
  description?: string;
  strategy?: string;
  backoff_seconds?: number;
  retry_number?: number;
  max_retries?: number;
}

export function HealingToast() {
  const fetchHealingIssues = useOverviewStore((s) => s.fetchHealingIssues);
  const subscribeHealingEvents = useOverviewStore((s) => s.subscribeHealingEvents);

  // Subscribe to healing-issue-updated for selective re-fetch
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    subscribeHealingEvents().then((fn) => {
      if (cancelled) { fn(); } else { unlistenFn = fn; }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [subscribeHealingEvents]);

  // Subscribe to healing-event for toast notifications
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;

    listen<HealingEventPayload>('healing-event', (event) => {
      if (cancelled) return;
      const payload = event.payload;
      // Only show toasts for non-auto-fixed issues
      if (payload.auto_fixed) return;
      // Only show for critical and high severity
      if (payload.severity !== 'critical' && payload.severity !== 'high') return;

      useToastStore.getState().addHealingToast({
        issueId: payload.issue_id,
        personaId: payload.persona_id,
        title: payload.title,
        severity: payload.severity,
        personaName: payload.persona_name,
        suggestedFix: payload.suggested_fix,
      });

      // Also refresh the healing issues store
      fetchHealingIssues();
    }).then((fn) => {
      if (cancelled) { fn(); } else { unlistenFn = fn; }
    });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, [fetchHealingIssues]);

  // No UI -- the unified ToastContainer handles rendering
  return null;
}
