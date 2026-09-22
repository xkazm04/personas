/**
 * The ambient notice for work a paired device asked THIS device to run.
 *
 * The answering turn runs with `suppress_chat`, so nothing appears in the
 * transcript — by explicit product choice. The operator asked for "ambient
 * awareness without stealing focus", so this is a quiet chip docked beside the
 * orb: no modal, no focus grab, no chat entry. The durable record is the row in
 * Settings → Devices.
 *
 * It renders at most ONE notice (the most recently changed) and lives in
 * `AthenaGuideLayer`'s always-on body portal, so an errand arriving while the
 * operator is on any screen still surfaces. It yields entirely while a decision
 * bubble is up: that surface docks against the same orb and is asking for an
 * answer, which outranks an FYI.
 */
import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CircleAlert, CircleCheck, Laptop, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { useSystemStore } from '@/stores/systemStore';
import { activeRemoteJobNotice } from '@/lib/network/remoteJobNotice';
import { useCompanionStore } from '../companionStore';
import { ORB_SIZE } from './AthenaOrb';

const CHIP_GAP = 12;
/**
 * How often the expiry sweep runs. A notice clears on its own TTL, so the
 * cadence only bounds how late that clear is, not whether it happens.
 */
const EXPIRY_TICK_MS = 2_000;

export function RemoteJobNoticeChip() {
  const { t, tx } = useTranslation();
  const reduceMotion = useReducedMotion();
  const notices = useSystemStore((s) => s.remoteJobNotices);
  const expireRemoteJobNotices = useSystemStore((s) => s.expireRemoteJobNotices);
  const dismissRemoteJobNotice = useSystemStore((s) => s.dismissRemoteJobNotice);
  const orbTarget = useCompanionStore((s) => s.orbGuideTarget);
  const orbPos = useSystemStore((s) => s.companionOrbPos);
  const decision = useCompanionStore((s) => s.pendingDecision);

  const notice = activeRemoteJobNotice(notices);
  const hasNotices = notices.length > 0;

  // Sweep expired notices. Only ticks while something is on screen, so an idle
  // app pays nothing; a `started` whose terminal event never arrives is cleared
  // by the same sweep rather than pinning the chip forever.
  useEffect(() => {
    if (!hasNotices) return;
    const id = window.setInterval(expireRemoteJobNotices, EXPIRY_TICK_MS);
    return () => window.clearInterval(id);
  }, [hasNotices, expireRemoteJobNotices]);

  if (!notice || decision) return null;

  const st = t.sharing;
  const device = notice.source || st.link_device;
  const label =
    notice.phase === 'started'
      ? tx(st.remote_notice_started, { device })
      : notice.phase === 'completed'
        ? tx(st.remote_notice_completed, { device })
        : tx(st.remote_notice_failed, { device });

  const Icon =
    notice.phase === 'started' ? Laptop : notice.phase === 'completed' ? CircleCheck : CircleAlert;
  const tone =
    notice.phase === 'failed' ? 'text-status-warning' : notice.phase === 'completed' ? 'text-primary' : 'text-cyan-400';

  // Dock BELOW the orb — the decision bubble and the guide caption both claim
  // the space above it, so the notice never competes for the same pixels.
  const anchorLeft = orbTarget?.left ?? orbPos.x * Math.max(window.innerWidth - ORB_SIZE, 0);
  const anchorTop = orbTarget?.top ?? orbPos.y * Math.max(window.innerHeight - ORB_SIZE, 0);
  const dockedLeft = anchorLeft + ORB_SIZE / 2 < window.innerWidth / 2;
  const pos: CSSProperties = dockedLeft
    ? { left: anchorLeft, top: anchorTop + ORB_SIZE + CHIP_GAP }
    : { right: window.innerWidth - anchorLeft - ORB_SIZE, top: anchorTop + ORB_SIZE + CHIP_GAP };

  return (
    <motion.div
      data-testid="remote-job-notice"
      data-remote-job-id={notice.jobId}
      data-remote-job-phase={notice.phase}
      initial={reduceMotion ? false : { opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      role="status"
      aria-label={st.remote_notice_label}
      className="pointer-events-auto fixed z-[59] max-w-[300px] rounded-card bg-background/95 border border-primary/25 shadow-elevation-2 pl-2.5 pr-1.5 py-1.5 flex items-start gap-2"
      style={pos}
    >
      <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${tone}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="typo-caption text-foreground/90 block break-words">{label}</span>
        {notice.phase !== 'started' && notice.summary && (
          <span
            data-testid="remote-job-notice-summary"
            className="typo-label text-foreground block break-words line-clamp-2 mt-0.5"
          >
            {notice.summary}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={() => dismissRemoteJobNotice(notice.jobId)}
        data-testid="remote-job-notice-dismiss"
        aria-label={st.remote_notice_dismiss}
        title={st.remote_notice_dismiss}
        className="shrink-0 inline-flex items-center justify-center w-5 h-5 rounded-full text-foreground hover:bg-secondary transition-colors focus-ring"
      >
        <X className="w-3 h-3" aria-hidden />
      </button>
    </motion.div>
  );
}
