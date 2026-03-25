import { useEffect, useRef, useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { cloudReconnectFromKeyring, cloudGetConfig } from '@/api/system/cloud';
import { CLOUD_BACKOFF_STEPS, type CloudReconnectState } from '@/stores/slices/system/cloudSlice';
import { isAuthError } from '@/stores/slices/system/deployTarget';

const HEALTH_POLL_INTERVAL = 30_000; // 30s between health pings when connected

/**
 * Monitors cloud connection health after a successful connection.
 *
 * - Polls `cloudFetchStatus` every 30s while connected.
 * - If the poll fails (orchestrator unreachable), marks the connection as
 *   dropped and begins auto-reconnection with exponential backoff
 *   (5s → 10s → 20s → 60s cap).
 * - On successful reconnection, restores normal health polling.
 * - Stops entirely when the user explicitly disconnects or on auth errors.
 */
export function useCloudHealthMonitor() {
  const isConnected = useSystemStore((s) => s.cloudConfig?.is_connected ?? false);
  const reconnectState = useSystemStore((s) => s.cloudReconnectState);
  const wasConnectedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Health check: try cloudGetConfig. If connected, fine. If not, trigger reconnect loop.
  const runHealthCheck = useCallback(async () => {
    if (unmountedRef.current) return;
    const store = useSystemStore.getState();
    // Don't health-check if already reconnecting or user disconnected
    if (store.cloudReconnectState.isReconnecting) return;

    try {
      const config = await cloudGetConfig();
      if (config?.is_connected) {
        // Still connected — schedule next check
        timerRef.current = setTimeout(runHealthCheck, HEALTH_POLL_INTERVAL);
      } else {
        // Connection dropped — start reconnect loop
        startReconnectLoop();
      }
    } catch {
      // Error reaching backend — start reconnect loop
      startReconnectLoop();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startReconnectLoop = useCallback(() => {
    if (unmountedRef.current) return;
    const store = useSystemStore.getState();
    if (store.cloudReconnectState.isReconnecting) return;

    const attempt = 0;
    const delay = CLOUD_BACKOFF_STEPS[0]!;
    useSystemStore.setState({
      cloudReconnectState: { isReconnecting: true, attempt, nextRetryAt: Date.now() + delay },
    });
    timerRef.current = setTimeout(() => attemptReconnect(0), delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attemptReconnect = useCallback(async (attempt: number) => {
    if (unmountedRef.current) return;

    try {
      const latencyMs = await cloudReconnectFromKeyring();
      const config = await cloudGetConfig();

      if (unmountedRef.current) return;

      if (config?.is_connected) {
        // Success — restore normal state
        useSystemStore.setState({
          cloudConfig: config,
          cloudConnectionLatencyMs: latencyMs || null,
          cloudReconnectState: { isReconnecting: false, attempt: 0, nextRetryAt: null },
          cloudError: null,
        });
        // Resume health polling
        timerRef.current = setTimeout(runHealthCheck, HEALTH_POLL_INTERVAL);
        return;
      }
    } catch (err) {
      if (isAuthError(err)) {
        // Auth error — stop trying, notify user
        useSystemStore.setState({
          cloudReconnectState: { isReconnecting: false, attempt: 0, nextRetryAt: null },
          cloudError: 'Credentials expired or revoked. Please reconnect to the cloud orchestrator.',
        });
        return;
      }
    }

    if (unmountedRef.current) return;

    // Schedule next attempt with backoff
    const nextAttempt = attempt + 1;
    const backoffIndex = Math.min(nextAttempt, CLOUD_BACKOFF_STEPS.length - 1);
    const delay = CLOUD_BACKOFF_STEPS[backoffIndex]!;

    const nextState: CloudReconnectState = {
      isReconnecting: true,
      attempt: nextAttempt,
      nextRetryAt: Date.now() + delay,
    };
    useSystemStore.setState({ cloudReconnectState: nextState });
    timerRef.current = setTimeout(() => attemptReconnect(nextAttempt), delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    unmountedRef.current = false;

    if (isConnected && !reconnectState.isReconnecting) {
      // Connection is live — start health polling
      wasConnectedRef.current = true;
      clearTimer();
      timerRef.current = setTimeout(runHealthCheck, HEALTH_POLL_INTERVAL);
    } else if (!isConnected && wasConnectedRef.current && !reconnectState.isReconnecting) {
      // Was connected but now dropped (external state change) — start reconnect
      startReconnectLoop();
    }

    return () => {
      unmountedRef.current = true;
      clearTimer();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, reconnectState.isReconnecting]);

  // When user explicitly disconnects, reset our tracking
  useEffect(() => {
    if (!isConnected && !reconnectState.isReconnecting) {
      wasConnectedRef.current = false;
    }
  }, [isConnected, reconnectState.isReconnecting]);
}
