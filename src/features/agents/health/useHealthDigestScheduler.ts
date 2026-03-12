import { useEffect, useRef } from 'react';
import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import { getAppSetting, setAppSetting } from '@/api/system/settings';
import { usePersonaStore } from '@/stores/personaStore';

const LAST_DIGEST_KEY = 'health_digest_last_run';
const DIGEST_ENABLED_KEY = 'health_digest_enabled';
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Scheduler hook that checks on mount whether a weekly health digest
 * is overdue. If so, it runs the full digest and sends a native
 * desktop notification summarizing the results.
 *
 * Mount this once at the app root level.
 */
export function useHealthDigestScheduler() {
  const ran = useRef(false);
  const running = useRef(false);
  const personasLoaded = usePersonaStore((s) => s.personas.length > 0);

  useEffect(() => {
    if (ran.current || running.current || !personasLoaded) return;
    running.current = true;

    (async () => {
      try {
        // Check if digest is enabled (default: true)
        const enabledRaw = await getAppSetting(DIGEST_ENABLED_KEY).catch(() => null);
        if (enabledRaw === 'false') {
          ran.current = true; // User disabled digests — no retry needed
          return;
        }

        // Check when we last ran
        const lastRunRaw = await getAppSetting(LAST_DIGEST_KEY).catch(() => null);
        const lastRunMs = lastRunRaw ? new Date(lastRunRaw).getTime() : 0;
        const now = Date.now();

        if (now - lastRunMs < ONE_WEEK_MS) {
          ran.current = true; // Not yet due — no retry needed
          return;
        }

        // Run the digest
        const digest = await usePersonaStore.getState().runFullHealthDigest();
        if (!digest) return; // Will retry on next effect cycle

        // Record timestamp
        await setAppSetting(LAST_DIGEST_KEY, new Date().toISOString());

        // Digest succeeded — latch so we don't re-run this session
        ran.current = true;

        // Send native notification
        const { totalScore, totalIssues, errorCount, warningCount } = digest;
        const gradeEmoji = totalScore.grade === 'healthy' ? '\u2705' : totalScore.grade === 'degraded' ? '\u26A0\uFE0F' : '\u274C';
        const title = `${gradeEmoji} Weekly Agent Health Digest`;
        const body = totalIssues === 0
          ? `All ${digest.personas.length} agents are healthy! Score: ${totalScore.value}/100`
          : `Score: ${totalScore.value}/100 \u00b7 ${totalIssues} issue${totalIssues !== 1 ? 's' : ''} across ${digest.personas.length} agent${digest.personas.length !== 1 ? 's' : ''} (${errorCount} errors, ${warningCount} warnings)`;

        await invoke<void>('send_app_notification', { title, body }).catch(() => {
          // Notification permission may not be granted -- silently ignore
        });
      } catch {
        // Transient failure — unlock so next render cycle retries
        running.current = false;
      }
    })();
  }, [personasLoaded]);
}
