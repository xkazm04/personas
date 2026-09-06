import { useEffect, useRef } from 'react';
import { sendAppNotification } from "@/api/system/system";
import { getAppSetting, setAppSetting } from '@/api/system/settings';
import { silentCatch, silentCatchNull } from "@/lib/silentCatch";
import { useAgentStore } from "@/stores/agentStore";
import { getActiveTranslations, interpolate } from "@/i18n/useTranslation";

const LAST_DIGEST_KEY = 'health_digest_last_run';
const DIGEST_ENABLED_KEY = 'health_digest_enabled';
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How far in the future a stored stamp may sit before it is treated as
 * corrupt. A stamp written while the clock was wrong (or in another zone's
 * local time) would otherwise make `now - last < ONE_WEEK_MS` true for a week
 * PAST the bogus moment — a stamp 30 days ahead silences the digest for 37.
 * A day absorbs any zone or DST confusion; nothing legitimate is further out.
 */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a stored last-run timestamp. Returns `null` for any value that is
 * missing, empty, non-ISO, produces a NaN when parsed, or lies more than
 * {@link FUTURE_TOLERANCE_MS} ahead of `now` — callers should treat `null` as
 * "never run" and overwrite with a fresh ISO string.
 *
 * Exported for unit tests.
 */
export function parseLastRunMs(raw: string | null | undefined, now: number = Date.now()): number | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const ms = new Date(raw).getTime();
  if (!Number.isFinite(ms)) return null;
  if (ms > now + FUTURE_TOLERANCE_MS) return null;
  return ms;
}

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
  const personasLoaded = useAgentStore((s) => s.personas.length > 0);

  useEffect(() => {
    if (ran.current || running.current || !personasLoaded) return;
    running.current = true;

    const abort = new AbortController();

    (async () => {
      try {
        // Check if digest is enabled (default: true)
        const enabledRaw = await getAppSetting(DIGEST_ENABLED_KEY).catch(silentCatchNull("useHealthDigestScheduler:checkDigestEnabled"));
        if (abort.signal.aborted) return;
        if (enabledRaw === 'false') {
          ran.current = true; // User disabled digests — no retry needed
          return;
        }

        // Check when we last ran
        const lastRunRaw = await getAppSetting(LAST_DIGEST_KEY).catch(silentCatchNull("useHealthDigestScheduler:checkLastRunTimestamp"));
        if (abort.signal.aborted) return;
        // Guard against corrupt/legacy timestamp values: treat any non-ISO or unparseable
        // string as "never run" so we run once and immediately rewrite a valid ISO stamp,
        // instead of spamming the digest on every launch when `now - NaN` is always false.
        const now = Date.now();
        const lastRunMs = parseLastRunMs(lastRunRaw, now);

        if (lastRunMs !== null && now - lastRunMs < ONE_WEEK_MS) {
          ran.current = true; // Not yet due — no retry needed
          return;
        }

        // Run the digest
        const digest = await useAgentStore.getState().runFullHealthDigest();
        if (abort.signal.aborted) return;
        if (!digest) {
          // Attempt failed (transient). Previously we returned without latching
          // ran.current and the finally below released running.current, so the
          // next flip of `personasLoaded` (or a strict-mode remount) re-fired
          // the effect and re-ran the whole digest. Treat one attempt per app
          // session as the contract: if it failed, the user retries by
          // restarting the app. (There is no "run digest now" control;
          // NotificationSettings only exposes the enable/disable toggle.)
          ran.current = true;
          return;
        }

        // Record timestamp
        await setAppSetting(LAST_DIGEST_KEY, new Date().toISOString());

        // Digest succeeded — latch so we don't re-run this session
        ran.current = true;

        // Send native notification (translated via getActiveTranslations
        // since this lives outside React's render cycle).
        const { totalScore, totalIssues, errorCount, warningCount } = digest;
        const personaCount = digest.personas.length;
        const gradeEmoji = totalScore.grade === 'healthy' ? '\u2705' : totalScore.grade === 'degraded' ? '\u26A0\uFE0F' : '\u274C';
        const notif = getActiveTranslations().agents.health_digest;
        const title = interpolate(notif.notification_title, { gradeEmoji });
        let body: string;
        if (totalIssues === 0) {
          const tmpl = personaCount === 1
            ? notif.notification_body_all_healthy_one
            : notif.notification_body_all_healthy_other;
          body = interpolate(tmpl, { count: personaCount, score: totalScore.value });
        } else {
          const issuesText = interpolate(
            totalIssues === 1 ? notif.notification_issues_one : notif.notification_issues_other,
            { count: totalIssues },
          );
          const agentsText = interpolate(
            personaCount === 1 ? notif.notification_agents_one : notif.notification_agents_other,
            { count: personaCount },
          );
          const breakdown = interpolate(notif.notification_breakdown, { errors: errorCount, warnings: warningCount });
          body = interpolate(notif.notification_body_with_issues, {
            score: totalScore.value,
            issues: issuesText,
            agents: agentsText,
            breakdown,
          });
        }

        await sendAppNotification(title, body).catch(silentCatch("useHealthDigestScheduler:sendAppNotification"));
      } catch (err) {
        // The IIFE's rejection is otherwise unobserved — without this catch a
        // throw from setAppSetting (or a future unguarded await) becomes an
        // unhandled promise rejection with no Sentry breadcrumb.
        silentCatch("useHealthDigestScheduler:run")(err);
      } finally {
        // Always unlock unless digest completed or was permanently skipped
        if (!ran.current) {
          running.current = false;
        }
      }
    })();

    return () => {
      abort.abort();
      // Strict-mode cleanup: allow the second mount's effect to run
      if (!ran.current) {
        running.current = false;
      }
    };
  }, [personasLoaded]);
}
