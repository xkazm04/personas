/** GlyphCinemaLayout — "Cinema": the Glyph Full compose + a build-loading cinema.
 *
 *  Compose IS GlyphFullLayout (the flagship CommandPanel). The build between
 *  launch and the first clarifying question runs 50-155s+ as ONE silent LLM turn
 *  that bursts its structured output near the end (measured — see
 *  tools/test-mcp/cinema-timing-findings.md). The real persona identity
 *  (behavior_core: role + mission) streams in EARLY-when-possible via the B2
 *  backend change (2-104s ahead of the burst); capabilities/connectors land only
 *  at the burst. So the cinema is wow-first with real data layered opportunistically:
 *
 *  1. Casting (0-~28s): a crowd of abstract persona silhouettes is discarded
 *     one-by-one down to a small finalist pool.
 *  2. Deliberation (until real identity or the question arrives): the finalists
 *     hold in suspense under a sweeping scan — the self-sustaining filler that
 *     gracefully covers the unbounded, variable wait.
 *  3. Coronation = the payoff: the instant the REAL behavior_core streams in
 *     (B2), one finalist is crowned and morphs into the real identity — the
 *     silhouette flies to the hero slot and the real role + mission populate.
 *  4. Capability assembly: real capability titles + connectors stream in as they
 *     resolve (mostly at the burst, just before handoff).
 *
 *  Fast-forward: if the question arrives before any of this completes, crown +
 *  reveal whatever's real, flash the capabilities, then hand off to
 *  GlyphStageSurface for the question round (where the final, well-formed
 *  persona/capability metadata lives once answered).
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Cpu, Plug, Sparkles } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { GlyphTopBar } from "./GlyphTopBar";
import { GlyphFullLayout } from "./GlyphFullLayout";
import { GlyphStageSurface } from "./GlyphStageSurface";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";
import { CINEMA_FORMS, CINEMA_PALETTE, CinemaSilhouette, dedupeConnectorNames, capabilityTitles } from "./cinemaShared";

const EASE = [0.16, 1, 0.3, 1] as const;
const CANDIDATE_COUNT = 30;
const FINALIST_FLOOR = 3;         // narrow the crowd to this, then hold in suspense
const CASTING_MS = 28000;         // time to narrow the crowd down to the finalists
const REVEAL_INTERVAL_MS = 900;   // beat between capability/connector reveals

export function GlyphCinemaLayout(props: GlyphFullLayoutProps) {
  const { hasDesignResult, pendingQuestions, isBuilding, buildPhase, agentName, onAgentNameChange } = props;

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const isCompose = buildSessionId === null && !hasDesignResult;
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const inBuild = buildSessionId !== null && !hasDesignResult;

  const [firstQuestionSeen, setFirstQuestionSeen] = useState(false);
  const [fastForward, setFastForward] = useState(false);
  useEffect(() => { setFirstQuestionSeen(false); setFastForward(false); }, [buildSessionId]);
  useEffect(() => {
    if (hasPending && !firstQuestionSeen) {
      setFastForward(true);
      // Let the coronation + capability flash play briefly before the question.
      const h = window.setTimeout(() => setFirstQuestionSeen(true), 2600);
      return () => clearTimeout(h);
    }
  }, [hasPending, firstQuestionSeen]);

  // Keep the cinema up for the whole pre-question wait. buildPhase stays
  // "analyzing" until awaiting_input (measured), so we don't gate on it — we
  // gate on "in a build and the first question hasn't been handed off yet".
  const showCinema = inBuild && !firstQuestionSeen;

  if (isCompose) return <GlyphFullLayout {...props} />;

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1" data-testid="build-layout-cinema">
      <div className="flex flex-col items-center pb-14 pt-4">
        <div className="w-full max-w-[1200px] flex flex-col items-center gap-3">
          <GlyphTopBar
            agentName={agentName}
            onAgentNameChange={onAgentNameChange}
            isPreBuild={false}
            isBuilding={isBuilding}
            buildPhase={buildPhase}
            face="glyph"
            onFaceChange={() => {}}
            editLocked={hasPending}
          />
          {showCinema ? (
            <CinemaStage agentName={agentName} fastForward={fastForward} />
          ) : (
            <GlyphStageSurface {...props} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Persona silhouettes ───────────────────────────────────────────── */
/* (FORMS/PALETTE/Silhouette live in ./cinemaShared, shared with the
   GlyphDialogueCinemaLayout reel variant.) */

const FORMS = CINEMA_FORMS;
const PALETTE = CINEMA_PALETTE;

interface Candidate { id: string; form: number; color: string; }

function makeCandidates(n: number): Candidate[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p-${i}`, form: i % FORMS.length, color: PALETTE[i % PALETTE.length]! }));
}

const Silhouette = CinemaSilhouette;

/* ─── Casting choreography ──────────────────────────────────────────── */

type CastingPhase = "casting" | "deliberation" | "crowned";

/** Narrow the crowd to FINALIST_FLOOR over CASTING_MS, then HOLD (deliberation)
 *  until `coronation` fires — at which point one finalist is crowned. This is
 *  what makes the cinema self-sustaining across the variable, unbounded wait:
 *  it never runs out of film before the real identity (or the question) lands.
 *  `coronation` is driven by the real behavior_core arriving (B2) or fast-forward. */
function useCasting(ids: string[], coronation: boolean, fastForward: boolean) {
  const maxToFloor = Math.max(0, ids.length - FINALIST_FLOOR);
  const step = CASTING_MS / Math.max(1, maxToFloor);
  const [discarded, setDiscarded] = useState(0);
  useEffect(() => { setDiscarded(0); }, [ids]);
  useEffect(() => {
    if (fastForward || coronation) return; // freeze the crowd; coronation branch handles the rest
    if (discarded >= maxToFloor) return;
    const h = window.setTimeout(() => setDiscarded((d) => d + 1), step);
    return () => clearTimeout(h);
  }, [discarded, maxToFloor, step, coronation, fastForward]);

  const crowned = coronation || fastForward;
  const keep = crowned ? 1 : ids.length - discarded;
  const phase: CastingPhase = crowned ? "crowned" : discarded >= maxToFloor ? "deliberation" : "casting";
  return {
    phase,
    eliminated: ids.slice(keep),
    finalists: ids.slice(0, Math.max(keep, 1)),
    winner: crowned ? ids[0] ?? null : null,
  };
}

/** Reveal items one-per-beat so a burst of real data still plays out over time. */
function useTimedReveal<T>(items: T[], intervalMs: number, immediate: boolean): T[] {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (immediate) { setShown(items.length); return; }
    if (shown >= items.length) return;
    const h = window.setTimeout(() => setShown((s) => s + 1), intervalMs);
    return () => clearTimeout(h);
  }, [shown, items.length, intervalMs, immediate]);
  return items.slice(0, immediate ? items.length : shown);
}

function CinemaStage({ agentName, fastForward }: { agentName: string; fastForward: boolean }) {
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const capabilities = useAgentStore((s) => s.buildCapabilities);
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const personaResolution = useAgentStore((s) => s.buildPersonaResolution);
  const activity = useAgentStore((s) => s.buildActivity);

  const candidates = useMemo(() => makeCandidates(CANDIDATE_COUNT), []);
  const ids = useMemo(() => candidates.map((c) => c.id), [candidates]);

  // The coronation trigger IS the real-identity arrival — the wow moment fuses
  // with the real data. Fast-forward crowns whatever we have when the question lands.
  const hasCore = !!(behaviorCore?.identity?.role || behaviorCore?.mission);
  const { phase, eliminated, finalists, winner } = useCasting(ids, hasCore, fastForward);
  const winnerCand = candidates.find((c) => c.id === winner) ?? candidates[0]!;

  const role = behaviorCore?.identity?.role ?? null;
  const mission = behaviorCore?.mission ?? null;
  const capTitles = useMemo(
    () => capabilityTitles(capabilityOrder, capabilities),
    [capabilityOrder, capabilities],
  );
  const connectorNames = useMemo(
    () => dedupeConnectorNames(personaResolution.connectors),
    [personaResolution],
  );

  const crowned = phase === "crowned";
  const headline = crowned ? "Meet your persona" : phase === "deliberation" ? "Weighing the final candidates" : "Casting your persona";

  return (
    <div className="relative w-full flex flex-col items-center overflow-hidden rounded-modal" style={{ minHeight: 560 }} data-testid="cinema-stage">
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{ width: 660, height: 660, background: `radial-gradient(circle, ${colorWithAlpha(winnerCand.color, crowned ? 0.16 : 0.09)}, transparent 62%)` }}
      />

      <div className="relative z-10 mt-4 mb-3 flex flex-col items-center gap-1 text-center px-4">
        <span className="typo-label text-foreground">{headline}</span>
        <AnimatePresence mode="wait">
          {activity && (
            <motion.span
              key={activity}
              initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 3 }}
              transition={{ duration: 0.25 }}
              className="typo-caption max-w-[460px] truncate"
            >
              {activity}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <CastingBar phase={phase} />

      <AnimatePresence mode="wait">
        {!crowned ? (
          <motion.div key="crowd" data-testid="cinema-casting" exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.4 }} className="relative z-10 w-full mt-4">
            <EliminationCrowd candidates={candidates} eliminated={eliminated} finalists={finalists} deliberating={phase === "deliberation"} />
          </motion.div>
        ) : (
          <motion.div key="crowned" data-testid="cinema-capability" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="relative z-10 w-full mt-5">
            <CrownedIdentity
              winner={winnerCand}
              agentName={agentName}
              role={role}
              mission={mission}
              capTitles={capTitles}
              connectors={connectorNames}
              fastForward={fastForward}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Progress bar: determinate fill through casting, an indeterminate shimmer
 *  through the (unbounded) deliberation hold, then snaps full on coronation. */
function CastingBar({ phase }: { phase: CastingPhase }) {
  return (
    <div className="w-full max-w-[520px] px-4">
      <div className="relative h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden">
        {phase === "casting" && (
          <motion.span
            className="block h-full rounded-full bg-primary"
            initial={{ width: "0%" }} animate={{ width: "88%" }}
            transition={{ duration: CASTING_MS / 1000, ease: "linear" }}
          />
        )}
        {phase === "deliberation" && (
          <>
            <span className="block h-full rounded-full bg-primary/80" style={{ width: "88%" }} />
            <motion.span
              className="absolute inset-y-0 w-1/4 rounded-full bg-primary/60 blur-[2px]"
              animate={{ left: ["-25%", "88%"] }}
              transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
            />
          </>
        )}
        {phase === "crowned" && (
          <motion.span
            className="block h-full rounded-full bg-primary"
            initial={{ width: "88%" }} animate={{ width: "100%" }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        )}
      </div>
    </div>
  );
}

/** The crowd — silhouettes discarded one-by-one; finalists glow + bob while the
 *  deliberation scan sweeps across them. */
function EliminationCrowd({ candidates, eliminated, finalists, deliberating }: { candidates: Candidate[]; eliminated: string[]; finalists: string[]; deliberating: boolean }) {
  return (
    <div className="flex flex-wrap items-end justify-center gap-x-4 gap-y-3 max-w-[760px] mx-auto px-4 pb-4">
      {candidates.map((c) => {
        const dead = eliminated.includes(c.id);
        const isFinalist = deliberating && finalists.includes(c.id);
        return (
          <motion.div
            key={c.id}
            layout
            layoutId={`cand-${c.id}`}
            initial={{ opacity: 0, y: 14, scale: 0.7 }}
            animate={
              dead
                ? { opacity: 0.26, y: 0, scale: 0.78, filter: "grayscale(1)" }
                : isFinalist
                  ? { opacity: 1, y: [0, -4, 0], scale: 1.12, filter: "grayscale(0)" }
                  : { opacity: 1, y: 0, scale: 1, filter: "grayscale(0)" }
            }
            transition={isFinalist ? { y: { duration: 1.8, repeat: Infinity, ease: "easeInOut" }, scale: { duration: 0.5, ease: EASE } } : { duration: 0.5, ease: EASE }}
            className="flex items-center justify-center rounded-full"
            style={{ width: isFinalist ? 64 : 52, height: isFinalist ? 64 : 52, background: dead ? "transparent" : `radial-gradient(circle at 50% 30%, ${colorWithAlpha(c.color, isFinalist ? 0.28 : 0.16)}, transparent 72%)` }}
          >
            <Silhouette form={c.form} color={c.color} size={isFinalist ? 46 : 38} dead={dead} />
          </motion.div>
        );
      })}
    </div>
  );
}

/** The payoff — crowned winner morphs into the REAL identity, capabilities +
 *  connectors assemble beneath it as they stream in. */
function CrownedIdentity({
  winner, agentName, role, mission, capTitles, connectors, fastForward,
}: {
  winner: Candidate; agentName: string; role: string | null; mission: string | null;
  capTitles: string[]; connectors: string[]; fastForward: boolean;
}) {
  const accent = winner.color;
  const shownCaps = useTimedReveal(capTitles, REVEAL_INTERVAL_MS, fastForward);
  const shownConnectors = useTimedReveal(connectors, REVEAL_INTERVAL_MS, fastForward);
  const hasIdentity = !!(role || mission);

  return (
    <div className="w-full max-w-[720px] mx-auto flex flex-col items-center gap-5">
      {/* winner flies up from its finalist slot into the hero position */}
      <div className="flex flex-col items-center gap-1.5">
        <motion.span
          layoutId={`cand-${winner.id}`}
          className="relative flex items-center justify-center rounded-full"
          style={{ width: 76, height: 76, background: `radial-gradient(circle at 50% 30%, ${colorWithAlpha(accent, 0.3)}, transparent 72%)`, border: `1px solid ${colorWithAlpha(accent, 0.5)}` }}
        >
          <Silhouette form={winner.form} color={accent} size={56} />
          <motion.span
            className="absolute -top-1 -right-1"
            initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ delay: 0.25, type: "spring", stiffness: 300, damping: 18 }}
          >
            <Sparkles className="w-4 h-4" style={{ color: accent }} />
          </motion.span>
        </motion.span>
        <span className="typo-title-lg text-foreground" data-testid="cinema-winner">{agentName?.trim() || "Your agent"}</span>
        {/* real identity streams in via B2 — skeleton until it lands */}
        {role ? (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="typo-caption text-center" style={{ color: accent }} data-testid="cinema-role">{role}</motion.span>
        ) : (
          <SkeletonLine width={200} />
        )}
        {mission ? (
          <motion.span initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="typo-caption text-foreground/80 max-w-[440px] text-center line-clamp-2">{mission}</motion.span>
        ) : !hasIdentity ? (
          <SkeletonLine width={320} />
        ) : null}
      </div>

      {/* capabilities assembling */}
      <div className="w-full flex flex-col items-center gap-2">
        <span className="typo-label text-foreground">Capabilities</span>
        <div className="w-full flex flex-col items-stretch gap-2 max-w-[460px]" data-testid="cinema-cap-list">
          <AnimatePresence initial={false}>
            {shownCaps.map((title, i) => (
              <motion.div
                key={title}
                layout
                initial={{ opacity: 0, x: i % 2 === 0 ? -40 : 40 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ type: "spring", stiffness: 240, damping: 24 }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-card border bg-card-bg"
                style={{ borderColor: colorWithAlpha(accent, 0.35) }}
              >
                <span className="w-5 h-5 rounded-full flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(accent, 0.2) }}>
                  <Check className="w-3 h-3" style={{ color: accent }} />
                </span>
                <span className="typo-body text-foreground truncate">{title}</span>
              </motion.div>
            ))}
          </AnimatePresence>
          {shownCaps.length === 0 && (
            <div className="flex items-center gap-2 justify-center py-2 typo-caption">
              <Cpu className="w-3.5 h-3.5 text-primary animate-pulse" />
              <span>Composing capabilities…</span>
            </div>
          )}
        </div>
      </div>

      {/* connectors docking */}
      {shownConnectors.length > 0 && (
        <div className="w-full flex flex-col items-center gap-2">
          <span className="typo-label text-foreground">Connectors</span>
          <div className="flex flex-wrap justify-center gap-1.5">
            <AnimatePresence>
              {shownConnectors.map((name) => {
                const meta = getConnectorMeta(name);
                return (
                  <motion.span
                    key={name}
                    layout
                    initial={{ opacity: 0, scale: 0.7, y: 12 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 260, damping: 22 }}
                    className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-0.5 rounded-full border"
                    style={{ borderColor: colorWithAlpha(meta.color, 0.4), background: colorWithAlpha(meta.color, 0.12) }}
                  >
                    <span className="w-5 h-5 rounded-full flex items-center justify-center" style={{ background: colorWithAlpha(meta.color, 0.15) }}>
                      <ConnectorIcon meta={meta} />
                    </span>
                    <span className="typo-caption text-foreground">{meta.label}</span>
                  </motion.span>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}
      {shownConnectors.length === 0 && shownCaps.length > 0 && (
        <span className="inline-flex items-center gap-1.5 typo-caption"><Plug className="w-3.5 h-3.5 text-primary animate-pulse" />Wiring connectors…</span>
      )}
    </div>
  );
}

/** Shimmer placeholder for real identity text that hasn't streamed in yet. */
function SkeletonLine({ width }: { width: number }) {
  return (
    <span
      className="block h-3 rounded-full bg-foreground/10 overflow-hidden relative"
      style={{ width }}
      aria-hidden
    >
      <motion.span
        className="absolute inset-y-0 w-1/3 bg-foreground/15 blur-[1px]"
        animate={{ left: ["-33%", "100%"] }}
        transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
      />
    </span>
  );
}
