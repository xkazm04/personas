import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Lightbulb, ChevronDown, ChevronUp, Loader2, Sparkles, MessageSquareText, TriangleAlert, ShieldCheck, Mail, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { explainDecision, runDecisionOption } from '../decision/resolveDecision';
import type { DecisionOption, DecisionSource } from '../decision/types';
import { ORB_SIZE } from './AthenaOrb';

const BUBBLE_GAP = 12;

/** Symbol shown on the collapsed chip, by what produced the decision. */
const SOURCE_ICON: Record<DecisionSource, LucideIcon> = {
  approval: ShieldCheck,
  human_review: MessageSquareText,
  incident: TriangleAlert,
  message_attention: Mail,
  adhoc: Sparkles,
};

/**
 * Athena hands-free decision bubble (P3, slices 2 + 4). A positioned,
 * numbered-choice surface that floats ABOVE the orb and asks the user to make
 * one decision — approve an action, resolve an incident, clear a human review.
 *
 * Mounted in `AthenaGuideLayer` (the always-on body portal) rather than inside
 * `AthenaOrb` (which only renders while `state === 'minimized'`), so a decision
 * can surface over any screen. Renders nothing unless `pendingDecision != null`
 * AND the presence state is `minimized` — the bubble docks against the orb, so
 * with the chat panel open (orb hidden) it stays hidden too and re-surfaces
 * when the panel closes.
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
  const companionState = useCompanionStore((s) => s.state);
  const explained = useCompanionStore((s) => s.decisionExplained);
  const composing = useCompanionStore((s) => s.explainComposing);
  const composeError = useCompanionStore((s) => s.explainComposeError);
  const orbTarget = useCompanionStore((s) => s.orbGuideTarget);
  const orbPos = useSystemStore((s) => s.companionOrbPos);
  // Float above the Fleet grid overlay (z-200) while it's open — a key
  // orchestration decision must be visible/answerable over the grid, not
  // buried behind it (same lift as the orb + chat panel).
  const fleetGridOpen = useSystemStore((s) => s.fleetGridOpen);
  const setState = useCompanionStore((s) => s.setState);
  const setGuidanceHighlightTestId = useCompanionStore((s) => s.setGuidanceHighlightTestId);
  const flashHighlight = useCompanionStore((s) => s.flashHighlight);

  const decisionId = decision?.id ?? null;
  const navigateRoute = decision?.navigateRoute;
  const highlightTestId = decision?.highlightTestId;

  // The bubble has three visibility levels: expanded (full), compact (small
  // chip) — toggled by the bottom chevron handle — and fully hidden (just a
  // tiny restore peek dotted at the orb) — toggled by the top-corner X. A
  // fresh decision always opens expanded + visible; both are per-decision
  // local state.
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    setCollapsed(false);
    setHidden(false);
  }, [decisionId]);

  // On a fresh decision: promote Athena out of dormancy so the orb is visible,
  // and ring the element the bubble is asking about (best-effort). Promote
  // ONLY from the dormant states — when the chat panel is `open` the user is
  // mid-conversation; yanking it down to the orb would close their chat. The
  // decision stays pending and the bubble surfaces once the panel closes.
  useEffect(() => {
    if (!decisionId) return;
    const presence = useCompanionStore.getState().state;
    if (presence === 'collapsed' || presence === 'closed') {
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

  // The bubble docks against the orb, which normally exists only while
  // `minimized` — with the chat panel open (or Athena dismissed) there's no
  // anchor, so render nothing (the decision stays in `pendingDecision` and
  // re-surfaces when the orb returns). EXCEPTION: in Grid mode the orb is lifted
  // over the fleet overlay (`AthenaOrbLayer` → z-[210]) and stays visible even
  // with the chat open, so a fleet orchestration decision MUST surface there —
  // otherwise an operator running the grid (often with the chat open to watch)
  // sees nothing to approve and Athena appears stuck. (User report 2026-06-25.)
  if (!decision || (companionState !== 'minimized' && !fleetGridOpen)) return null;

  // Click → run the option then clear. Shared with the `;`-leader key (Slice 5)
  // and spoken-number answering (Slice 7) via `runDecisionOption` so all three
  // input methods resolve identically.
  const pick = (opt: DecisionOption) => runDecisionOption(opt);

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

  // The arrow/handle bridges the surface to the orb AND is the show/hide
  // toggle. It sits at the bottom on the docked side, pointing at the orb.
  const handleSide: CSSProperties = dockedLeft ? { left: 14 } : { right: 14 };

  // A markdown-free label for the collapsed chip: the full first line of
  // the prompt, untruncated — the chip wraps instead of ellipsizing so the
  // title is always readable while minimized.
  const shortLabel =
    (decision.prompt.split('\n')[0] ?? decision.prompt)
      .replace(/[*_`#>]/g, '')
      .trim() || t.plugins.companion.decision_title;
  const SourceIcon = SOURCE_ICON[decision.source] ?? Sparkles;

  return (
    <motion.div
      data-testid="athena-decision-bubble"
      data-companion-decision-id={decision.id}
      data-companion-decision-source={decision.source}
      data-companion-decision-collapsed={collapsed}
      data-companion-decision-hidden={hidden}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={`pointer-events-auto fixed ${fleetGridOpen ? 'z-[220]' : 'z-[61]'} max-w-[80vw] ${hidden || collapsed ? 'w-auto' : 'w-[336px]'}`}
      style={pos}
    >
      {hidden ? (
        /* Fully hidden — a tiny restore peek dotted at the orb. Click to bring
           the decision back to its previous (compact or full) size. */
        <button
          type="button"
          onClick={() => setHidden(false)}
          data-testid="athena-decision-restore"
          aria-label={t.plugins.companion.decision_show}
          title={t.plugins.companion.decision_show}
          className="pointer-events-auto relative flex items-center justify-center w-9 h-9 rounded-full bg-background/95 border border-primary/30 shadow-elevation-3 hover:border-primary/50 transition-colors"
        >
          <span className="absolute -top-0.5 -right-0.5 flex w-2 h-2">
            {!reduceMotion && <span className="absolute inline-flex w-full h-full rounded-full bg-primary opacity-60 animate-ping" />}
            <span className="relative inline-flex w-2 h-2 rounded-full bg-primary" />
          </span>
          <SourceIcon className="w-4 h-4 text-primary" aria-hidden />
        </button>
      ) : (
        <>
      {collapsed ? (
        /* Compact chip — a small symbol/label above the arrow. Click to expand. */
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          data-testid="athena-decision-expand"
          aria-label={t.plugins.companion.decision_expand}
          className="flex items-center gap-2 rounded-card bg-background/95 border border-primary/30 shadow-elevation-3 pl-2.5 pr-3 py-2 hover:border-primary/50 transition-colors max-w-[420px]"
        >
          <span className="relative flex w-2 h-2 flex-shrink-0">
            {!reduceMotion && <span className="absolute inline-flex w-full h-full rounded-full bg-primary opacity-60 animate-ping" />}
            <span className="relative inline-flex w-2 h-2 rounded-full bg-primary" />
          </span>
          <SourceIcon className="w-4 h-4 text-primary flex-shrink-0" aria-hidden />
          {/* Wraps — never ellipsized; the chip caps line length, not content. */}
          <span className="typo-caption font-medium text-foreground/90 text-left whitespace-normal break-words min-w-0">
            {shortLabel}
          </span>
        </button>
      ) : (
        <div className="relative rounded-card bg-background/95 border border-primary/30 shadow-elevation-3 p-3.5">
          <div data-testid="athena-decision-prompt">
            <MarkdownRenderer content={decision.prompt} className="typo-body text-foreground/90 leading-relaxed" />
          </div>

          {/* Explain-in-Cockpit — composing / fallback states for the
              escalated `0` turn. The static recommendation below stays
              visible throughout (it's the floor). */}
          {composing && (
            <div
              data-testid="athena-decision-composing"
              className="mt-2.5 flex items-center gap-2 rounded-input border border-primary/20 bg-primary/5 px-3 py-2"
            >
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" aria-hidden />
              <span className="typo-caption text-foreground">
                {t.plugins.companion.decision_composing}
              </span>
            </div>
          )}
          {!composing && composeError && (
            <p
              data-testid="athena-decision-compose-failed"
              className="mt-2.5 typo-caption text-status-warning"
            >
              {t.plugins.companion.decision_compose_failed}
            </p>
          )}

          {/* Slice 4 — `0` was picked: show the recommendation above the options. */}
          {explained && decision.recommendation && (
            <div
              data-testid="athena-decision-recommendation"
              className="mt-2.5 rounded-input border border-primary/20 bg-primary/5 px-3 py-2.5"
            >
              <p className="typo-label uppercase tracking-wider font-semibold text-primary">
                {t.plugins.companion.decision_recommend_prefix}
              </p>
              <MarkdownRenderer content={decision.recommendation} className="mt-1 typo-body text-foreground/90 leading-relaxed" />
              {decision.detail && (
                <p className="mt-1.5 typo-caption text-foreground leading-relaxed">
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
                onClick={() => pick(opt)}
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
                <span className="text-left whitespace-normal break-words min-w-0">
                  {opt.label}
                </span>
              </button>
            ))}

            {/* `0` — explain + recommend (slice 4), escalating into the
                Explain-in-Cockpit turn. Icon-only (lightbulb); the `0` leader
                key still triggers it. Does not clear the decision; disabled
                while a composition is already in flight. */}
            <button
              type="button"
              data-testid="athena-decision-option-0"
              onClick={() => explainDecision()}
              disabled={composing}
              aria-label={t.plugins.companion.decision_explain}
              title={t.plugins.companion.decision_explain_hint}
              className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-interactive bg-foreground/5 border border-foreground/10 hover:bg-foreground/10 text-foreground transition-colors focus-ring disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Lightbulb className="w-4 h-4" aria-hidden />
            </button>
          </div>
        </div>
      )}

          {/* Fully-hide X — top-upper corner. Collapses the bubble to the
              restore peek (distinct from the bottom minimize/expand handle). */}
          <button
            type="button"
            onClick={() => setHidden(true)}
            data-testid="athena-decision-dismiss"
            aria-label={t.plugins.companion.decision_dismiss}
            title={t.plugins.companion.decision_dismiss}
            className="absolute -top-2.5 -right-2.5 z-10 inline-flex items-center justify-center w-6 h-6 rounded-full bg-background/95 border border-primary/25 text-foreground shadow-elevation-2 ring-2 ring-background hover:border-primary/50 transition"
          >
            <X className="w-3 h-3" />
          </button>

          {/* The arrow/handle — minimize ⇄ expand; points at the orb. */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            data-testid="athena-decision-toggle"
            aria-label={collapsed ? t.plugins.companion.decision_expand : t.plugins.companion.decision_minimize}
            title={collapsed ? t.plugins.companion.decision_expand : t.plugins.companion.decision_minimize}
            className="absolute -bottom-3 z-10 inline-flex items-center justify-center w-6 h-6 rounded-full bg-primary text-background shadow-elevation-2 ring-2 ring-background hover:brightness-110 transition"
            style={handleSide}
          >
            {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </>
      )}
    </motion.div>
  );
}
