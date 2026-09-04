import { useEffect, useRef, useCallback } from 'react';
import { useSystemStore } from '@/stores/systemStore';
import { cloudReconnectFromKeyring, cloudGetConfig } from '@/api/system/cloud';
import { CLOUD_BACKOFF_STEPS, CLOUD_MAX_RECONNECT_ATTEMPTS, type CloudReconnectState } from '@/stores/slices/system/cloudSlice';
import { isAuthError } from '@/stores/slices/system/deployTarget';

const HEALTH_POLL_INTERVAL = 30_000; // 30s between health pings when connected
// A tick that fires this far past the time it was armed did not run on time:
// the host slept or was suspended. Such a tick says something about the host,
// not the peer, so its first failure is not a verdict — the network is often
// still coming back when it lands.
const LATE_TICK_THRESHOLD = 2 * HEALTH_POLL_INTERVAL;
const LATE_TICK_REPROBE_DELAY = 3_000; // grace before the one re-probe a late tick gets

/**
 * Monitors cloud connection health after a successful connection.
 *
 * - Polls `cloudGetConfig` every 30s while connected (a config read, not the
 *   heavier `cloudFetchStatus` the store exposes for the Status tab).
 * - If the poll fails (orchestrator unreachable), marks the connection as
 *   dropped and begins auto-reconnection with exponential backoff
 *   (5s → 10s → 20s → 60s cap).
 * - A tick that fires long after it was scheduled (host resumed from sleep)
 *   re-probes once after a short grace instead; only that second failure
 *   starts the reconnect loop.
 * - On successful reconnection, restores normal health polling.
 * - Stops entirely when the user explicitly disconnects or on auth errors.
 */
export function useCloudHealthMonitor() {
  const isConnected = useSystemStore((s) => s.cloudConfig?.is_connected ?? false);
  const reconnectState = useSystemStore((s) => s.cloudReconnectState);
  const wasConnectedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);
  const runHealthCheckRef = useRef<(gen: number, lateTick?: boolean) => Promise<void>>(async () => undefined);
  const startReconnectLoopRef = useRef<(gen: number) => void>(() => undefined);
  const attemptReconnectRef = useRef<(attempt: number, gen: number) => Promise<void>>(async () => undefined);
  // Generation counter: incremented on every effect teardown (including unmount).
  // Async callbacks capture the generation at dispatch time and bail if it no
  // longer matches — prevents stale polls from stamping state after the
  // component unmounts or the connection state flips out from under them.
  const generationRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const isStale = useCallback((gen: number) => {
    return unmountedRef.current || gen !== generationRef.current;
  }, []);

  // Every health timer remembers when it was armed, so the tick can tell
  // whether it fired on time or is the first thing to run after a resume.
  const scheduleHealthCheck = useCallback((gen: number, delay: number = HEALTH_POLL_INTERVAL) => {
    const scheduledAt = Date.now();
    timerRef.current = setTimeout(() => {
      const lateTick = Date.now() - scheduledAt > LATE_TICK_THRESHOLD;
      void runHealthCheckRef.current(gen, lateTick);
    }, delay);
  }, []);

  // Health check: try cloudGetConfig. If connected, fine. If not, trigger reconnect loop.
  const runHealthCheck = useCallback(async (gen: number, lateTick = false) => {
    if (isStale(gen)) return;
    const store = useSystemStore.getState();
    // Don't health-check if already reconnecting or user disconnected
    if (store.cloudReconnectState.isReconnecting) return;

    try {
      const config = await cloudGetConfig();
      if (isStale(gen)) return;
      if (config?.is_connected) {
        // Still connected — schedule next check
        scheduleHealthCheck(gen);
      } else {
        // Connection dropped — start reconnect loop
        startReconnectLoopRef.current(gen);
      }
    } catch {
      if (isStale(gen)) return;
      if (lateTick) {
        // The host slept through this tick; the network may not be back yet.
        // One re-probe after a short grace — only its failure is a verdict.
        scheduleHealthCheck(gen, LATE_TICK_REPROBE_DELAY);
        return;
      }
      // Error reaching backend — start reconnect loop
      startReconnectLoopRef.current(gen);
    }
  }, [isStale, scheduleHealthCheck]);
  runHealthCheckRef.current = runHealthCheck;

  const startReconnectLoop = useCallback((gen: number) => {
    if (isStale(gen)) return;
    const store = useSystemStore.getState();
    if (store.cloudReconnectState.isReconnecting) return;

    const attempt = 0;
    const delay = CLOUD_BACKOFF_STEPS[0]!;
    useSystemStore.setState({
      cloudReconnectState: { isReconnecting: true, attempt, nextRetryAt: Date.now() + delay },
    });
    timerRef.current = setTimeout(() => void attemptReconnectRef.current(0, gen), delay);
  }, [isStale]);
  startReconnectLoopRef.current = startReconnectLoop;

  const attemptReconnect = useCallback(async (attempt: number, gen: number) => {
    if (isStale(gen)) return;

    try {
      const latencyMs = await cloudReconnectFromKeyring();
      const config = await cloudGetConfig();

      if (isStale(gen)) return;

      if (config?.is_connected) {
        // Success — restore normal state
        useSystemStore.setState({
          cloudConfig: config,
          cloudConnectionLatencyMs: latencyMs || null,
          cloudReconnectState: { isReconnecting: false, attempt: 0, nextRetryAt: null },
          cloudError: null,
        });
        // Resume health polling
        scheduleHealthCheck(gen);
        return;
      }
    } catch (err) {
      if (isStale(gen)) return;
      if (isAuthError(err)) {
        // Auth error — stop trying, notify user
        useSystemStore.setState({
          cloudReconnectState: { isReconnecting: false, attempt: 0, nextRetryAt: null },
          cloudError: 'Credentials expired or revoked. Please reconnect to the cloud orchestrator.',
        });
        return;
      }
    }

    if (isStale(gen)) return;

    // Schedule next attempt with backoff.
    //
    // The `Math.min` below bounds the INDEX into the schedule, not the number
    // of attempts — those are different things, and until 2026-08-16 only the
    // first one was bounded. Replayed: 5s, 10s, 20s, 60s, then 60s forever, at
    // 63 attempts an hour against an endpoint that is not answering, for as
    // long as the app stays open.
    //
    // A ceiling on the delay reads like a ceiling on the retry, which is why
    // this survived review. It is the same shape as the persisted OAuth backoff
    // whose index saturates while its attempt counter does not — see
    // retry-with-backoff.md. Two unbounded retries in this repo, both wearing a
    // bound that is not one.
    const nextAttempt = attempt + 1;
    if (nextAttempt > CLOUD_MAX_RECONNECT_ATTEMPTS) {
      useSystemStore.setState({
        cloudReconnectState: { isReconnecting: false, attempt: nextAttempt, nextRetryAt: null },
        // Reuse the terminal message shape already written for the auth case
        // above, so the UI has one "we stopped trying" state rather than two.
        cloudError:
          'Could not reach the cloud orchestrator after several attempts. Check the connection and retry.',
      });
      return;
    }
    const backoffIndex = Math.min(nextAttempt, CLOUD_BACKOFF_STEPS.length - 1);
    const delay = CLOUD_BACKOFF_STEPS[backoffIndex]!;

    const nextState: CloudReconnectState = {
      isReconnecting: true,
      attempt: nextAttempt,
      nextRetryAt: Date.now() + delay,
    };
    useSystemStore.setState({ cloudReconnectState: nextState });
    timerRef.current = setTimeout(() => void attemptReconnectRef.current(nextAttempt, gen), delay);
  }, [isStale, scheduleHealthCheck]);
  attemptReconnectRef.current = attemptReconnect;

  useEffect(() => {
    unmountedRef.current = false;
    const gen = ++generationRef.current;

    if (isConnected && !reconnectState.isReconnecting) {
      // Connection is live — start health polling
      wasConnectedRef.current = true;
      clearTimer();
      scheduleHealthCheck(gen);
    } else if (!isConnected && wasConnectedRef.current && !reconnectState.isReconnecting) {
      // Was connected but now dropped (external state change) — start reconnect
      startReconnectLoopRef.current(gen);
    }

    const generation = generationRef;
    const timer = timerRef;
    return () => {
      // Bump the generation so any in-flight async work stamps nothing.
      generation.current++;
      unmountedRef.current = true;
      if (timer.current != null) clearTimeout(timer.current);
      clearTimer();
    };
  }, [clearTimer, scheduleHealthCheck, isConnected, reconnectState.isReconnecting]);

  // When user explicitly disconnects, reset our tracking
  useEffect(() => {
    if (!isConnected && !reconnectState.isReconnecting) {
      wasConnectedRef.current = false;
    }
  }, [isConnected, reconnectState.isReconnecting]);
}
