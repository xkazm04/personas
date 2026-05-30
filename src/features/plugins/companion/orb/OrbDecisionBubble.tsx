import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Lightbulb } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { ORB_SIZE } from './AthenaOrb';

const BUBBLE_GAP = 12;

/**
 * Athena hands-free decision bubble (P3, slices 2 + 4). A positioned,
 * numbered-choice surface that floats ABOVE the orb and asks the user to make
 * one decision — approve an action, resolve an incident, clear a human review.
 *
 * Mounted in `AthenaGuideLayer` (the always-on body portal) rather than inside
 * `AthenaOrb` (which only renders while `state === 'minimized'`), so a decision
 * can surface over any screen. Renders nothing unless `pendingDecision != null`.
 *
 * Chrome + positioning mirror `GuideCaption` (rounded-card, bg-background/95,
 * shadow-elevation-3, a small primary tail pointing back at the orb, flipped to
 * whichever side has room off `orbGuideTarget`). The numbered chips copy
 * `QuickReplies`' render (a `{i+1}` digit badge + label).
 *
 * Interaction (click-only here; the `;`-leader key + voice land in later
 * slices):
 *  - clicking option `n` runs `option.run()` then `clearPendingDecision()`.
 *  - clicking `0` ("Explain / recommend") does NOT clear — it sets
 *    `decisionExplained` so the recommendation renders above the still-present
 *    options (slice 4).
 *
 * On mount it promotes Athena to `minimized` if she's dormant (so the orb the
 * bubble docks against is visible) and, when the decision carries a
 * `highlightTestId`, rings the relevant element via the shared guidance setters.
 */
export function OrbDecisionBubble() {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const decision = useCompanionStore((s) => s.pendingDecision);
  const explained = useCompanionStore((s) => s.decisionExplained);
  const orbTarget = useCompanionStore((s) => s.orbGuideTarget);
  const orbPos = useSystemStore((s) => s.companionOrbPos);
  const clearPendingDecision = useCompanionStore((s) => s.clearPendingDecision);
  const markDecisionExplained = useCompanionStore((s) => s.markDecisionExplained);
  const setState = useCompanionStore((s) => s.setState);
  const setGuidanceHighlightTestId = useCompanionStore((s) => s.setGuidanceHighlightTestId);
  const flashHighlight = useCompanionStore((s) => s.flashHighlight);

  const decisionId = decision?.id ?? null;
  const navigateRoute = decision?.navigateRoute;
  const highlightTestId = decision?.highlightTestId;

  // On a fresh decision: promote Athena out of dormancy so the orb is visible,
  // and ring the element the bubble is asking about (best-effort).
  useEffect(() => {
    if (!decisionId) return;
    if (useCompanionStore.getState().state !== 'minimized') {
      setState('minimized');
    }
    if (highlightTestId) {
      // Prefer the proactive one-shot flash (auto-clears, no walkthrough
      // needed); fall back to the durable guidance highlight if a walkthrough
      // is already holding the ring.
      if (useCompanionStore.getState().activeWalkthrough) {
        setGuidanceHighlightTestId(highlightTestId);
      } else {
        flashHighlight(highlightTestId, { label: t.plugins.companion.decision_title });
      }
    }
    // navigateRoute is carried on each option's run() (resolve/open paths
    // navigate when picked); we don't force-navigate on mere surfacing.
    void navigateRoute;
  }, [
    decisionId,
    highlightTestId,
    navigateRoute,
    setState,
    setGuidanceHighlightTestId,
    flashHighlight,
    t.plugins.companion.decision_title,
  ]);

  if (!decision) return null;

  const pick = (run: () => void | Promise<void>) => {
    try {
      const r = run();
      if (r && typeof (r as Promise<void>).then === 'function') {
        (r as Promise<void>).catch(silentCatch('companion/OrbDecisionBubble:run'));
      }
    } catch (err) {
      silentCatch('companion/OrbDecisionBubble:run')(err);
    }
    clearPendingDecision();
  };

  // Position off the orb's last-known target (set by the orb on drag/dock) or
  // the persisted dock fraction as a fallback so the bubble has a home even
  // before the orb has reported a pixel target this session.
  const fallbackLeft = orbPos.x * Math.max(window.innerWidth - ORB_SIZE, 0);
  const fallbackTop = orbPos.y * Math.max(window.innerHeight - ORB_SIZE, 0);
  const anchorLeft = orbTarget?.left ?? fallbackLeft;
  const anchorTop = orbTarget?.top ?? fallbackTop;

  const dockedLeft = anchorLeft + ORB_SIZE / 2 < window.innerWidth / 2;
  // Sit the bubble above the orb, nudged toward whichever side has room.
  const pos: CSSProperties = dockedLeft
    ? { left: anchorLeft, bottom: window.innerHeight - anchorTop + BUBBLE_GAP }
    : {
        right: window.innerWidth - anchorLeft - ORB_SIZE,
        bottom: window.innerHeight - anchorTop + BUBBLE_GAP,
      };

  // A primary tail pointing down toward the orb.
  const tail: CSSProperties = dockedLeft
    ? {
        left: 18,
        bottom: -7,
        borderLeft: '6px solid transparent',
        borderRight: '6px solid transparent',
        borderTop: '7px solid var(--color-primary)',
      }
    : {
        right: 18,
        bottom: -7,
        borderLeft: '6px solid transparent',
        borderRight: '6px solid transparent',
        borderTop: '7px solid var(--color-primary)',
      };

  return (
    <motion.div
      data-testid="athena-decision-bubble"
      data-companion-decision-id={decision.id}
      data-companion-decision-source={decision.source}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="pointer-events-auto fixed z-[61] w-[280px] max-w-[80vw] rounded-card bg-background/95 border border-primary/30 shadow-elevation-3 p-3"
      style={pos}
    >
      <span className="pointer-events-none absolute h-0 w-0" style={tail} aria-hidden />

      <p
        data-testid="athena-decision-prompt"
        className="typo-body text-foreground/90 leading-relaxed"
      >
        {decision.prompt}
      </p>

      {/* Slice 4 — `0` was picked: show the recommendation above the options. */}
      {explained && decision.recommendation && (
        <div
          data-testid="athena-decision-recommendation"
          className="mt-2 rounded-input border border-primary/20 bg-primary/5 px-2.5 py-2"
        >
          <p className="typo-caption font-medium text-primary">
            {t.plugins.companion.decision_recommend_prefix}
          </p>
          <p className="mt-0.5 typo-caption text-foreground/85 leading-relaxed">
            {decision.recommendation}
          </p>
          {decision.detail && (
            <p className="mt-1 typo-caption text-foreground/60 leading-relaxed">
              {decision.detail}
            </p>
          )}
        </div>
      )}

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {decision.options.map((opt, i) => (
          <button
            key={opt.key}
            type="button"
            data-testid={`athena-decision-option-${i + 1}`}
            onClick={() => pick(opt.run)}
            title={opt.hint ?? opt.label}
            className={`inline-flex items-center gap-1.5 max-w-full rounded-interactive px-2.5 py-1.5 typo-caption font-medium transition-colors focus-ring ${
              opt.danger
                ? 'bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 hover:border-rose-500/30 text-rose-400'
                : 'bg-primary/10 border border-primary/20 hover:bg-primary/20 hover:border-primary/30 text-primary'
            }`}
          >
            <span
              className={`inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-semibold ${
                opt.danger ? 'bg-rose-500/20' : 'bg-primary/20'
              }`}
              aria-hidden
            >
              {i + 1}
            </span>
            <span className="truncate">{opt.label}</span>
          </button>
        ))}

        {/* `0` — explain + recommend (slice 4). Does not clear the decision. */}
        <button
          type="button"
          data-testid="athena-decision-option-0"
          onClick={() => markDecisionExplained()}
          title={t.plugins.companion.decision_explain_hint}
          className="inline-flex items-center gap-1.5 max-w-full rounded-interactive bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 text-foreground/80 px-2.5 py-1.5 typo-caption font-medium transition-colors focus-ring"
        >
          <span
            className="inline-flex items-center justify-center w-4 h-4 rounded text-[10px] font-semibold bg-foreground/10"
            aria-hidden
          >
            0
          </span>
          <Lightbulb className="w-3.5 h-3.5" aria-hidden />
          <span className="truncate">{t.plugins.companion.decision_explain}</span>
        </button>
      </div>
    </motion.div>
  );
}
