/** GlyphCinemaLayout — "Cinema": the Glyph Full compose + a build-loading cinema.
 *
 *  Compose IS GlyphFullLayout (the flagship CommandPanel). During the >60s build
 *  between launch and the first clarifying question, two timed cinematic movements
 *  play, choreographed over the ACTUAL build event stream:
 *
 *  Movement 1 — Casting (0–30s, deterministic): a crowd of abstract persona
 *  silhouettes is discarded one-by-one as a hard 30s left→right progress bar
 *  fills; the survivor is crowned at 30s.
 *
 *  Movement 2 — Capabilities: a distinct assembly act — the winner up top, then
 *  the real capability titles and connectors stream in as moving tokens, revealed
 *  on a beat (a reveal scheduler paces the real stream so the act fills time even
 *  when data arrives in bursts). Not a sigil card — its own movement.
 *
 *  Fast-forward: if the first question arrives early, the crowd snap-cuts to the
 *  winner, the capability act flashes, then it hands off to GlyphStageSurface.
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, Cpu, Plug } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { GlyphTopBar } from "./GlyphTopBar";
import { GlyphFullLayout } from "./GlyphFullLayout";
import { GlyphStageSurface } from "./GlyphStageSurface";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

const EASE = [0.16, 1, 0.3, 1] as const;
const CASTING_MS = 30000;        // hard 30s casting duration (the progress bar)
const REVEAL_INTERVAL_MS = 1600; // beat between capability/connector reveals

export function GlyphCinemaLayout(props: GlyphFullLayoutProps) {
  const { hasDesignResult, pendingQuestions, isBuilding, buildPhase, agentName, onAgentNameChange, completeness, cellStates } = props;

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
      // Give the capability act a brief flash before revealing the question.
      const h = window.setTimeout(() => setFirstQuestionSeen(true), 2200);
      return () => clearTimeout(h);
    }
  }, [hasPending, firstQuestionSeen]);

  const isFirstWait = buildPhase === "initializing" || buildPhase === "analyzing";
  const showCinema = inBuild && !firstQuestionSeen && (isFirstWait || fastForward);

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
            <CinemaStage agentName={agentName} completeness={completeness} cellStates={cellStates} fastForward={fastForward} />
          ) : (
            <GlyphStageSurface {...props} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Persona silhouettes ───────────────────────────────────────────── */

const FORMS = [
  { hr: 7, hy: 12, tw: 14 },
  { hr: 6.4, hy: 11, tw: 12 },
  { hr: 7.6, hy: 13, tw: 16 },
  { hr: 6, hy: 11, tw: 13 },
  { hr: 8, hy: 13.5, tw: 15 },
] as const;

const PALETTE = ["#60A5FA", "#818CF8", "#22D3EE", "#34D399", "#FBBF24", "#FB7185", "#2DD4BF", "#FB923C", "#A78BFA", "#F472B6"];

interface Candidate { id: string; form: number; color: string; }

function makeCandidates(n: number): Candidate[] {
  return Array.from({ length: n }, (_, i) => ({ id: `p-${i}`, form: i % FORMS.length, color: PALETTE[i % PALETTE.length]! }));
}

function Silhouette({ form, color, size, dead }: { form: number; color: string; size: number; dead?: boolean }) {
  const f = FORMS[form] ?? FORMS[0]!;
  const c = dead ? "var(--muted-foreground)" : color;
  const shoulder = f.hy + f.hr;
  return (
    <svg viewBox="0 0 44 48" width={size} height={size} aria-hidden style={{ opacity: dead ? 0.5 : 1 }}>
      <circle cx={22} cy={f.hy} r={f.hr} fill={c} />
      <path
        d={`M ${22 - f.tw} 48 C ${22 - f.tw} ${shoulder + 5}, ${22 - f.tw + 2} ${shoulder}, 22 ${shoulder} C ${22 + f.tw - 2} ${shoulder}, ${22 + f.tw} ${shoulder + 5}, ${22 + f.tw} 48 Z`}
        fill={c}
      />
    </svg>
  );
}

/* ─── The loading cinema ────────────────────────────────────────────── */

const CANDIDATE_COUNT = 30;

interface CinemaStageProps {
  agentName: string;
  completeness: number;
  cellStates: Record<string, string>;
  fastForward: boolean;
}

/** Deterministic elimination: discard one per (30s / N) beat so the crowd
 *  narrows to the winner (ids[0]) at exactly 30s; fast-forward cuts instantly. */
function useElimination(ids: string[], fastForward: boolean) {
  const step = CASTING_MS / Math.max(1, ids.length - 1);
  const [discarded, setDiscarded] = useState(0);
  useEffect(() => { setDiscarded(0); }, [ids]);
  useEffect(() => {
    if (fastForward) { setDiscarded(ids.length - 1); return; }
    if (discarded >= ids.length - 1) return;
    const h = window.setTimeout(() => setDiscarded((d) => d + 1), step);
    return () => clearTimeout(h);
  }, [discarded, fastForward, ids.length, step]);
  const keep = ids.length - discarded;
  return {
    eliminated: ids.slice(keep),
    winner: keep <= 1 ? ids[0] ?? null : null,
  };
}

/** Reveal items one-per-beat so a burst of real data still plays out over time. */
function useTimedReveal<T>(items: T[], intervalMs: number, fastForward: boolean): T[] {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (fastForward) { setShown(items.length); return; }
    if (shown >= items.length) return;
    const h = window.setTimeout(() => setShown((s) => s + 1), intervalMs);
    return () => clearTimeout(h);
  }, [shown, items.length, intervalMs, fastForward]);
  return items.slice(0, Math.max(shown, fastForward ? items.length : 0));
}

function CinemaStage({ agentName, fastForward }: CinemaStageProps) {
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const capabilities = useAgentStore((s) => s.buildCapabilities);
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const personaResolution = useAgentStore((s) => s.buildPersonaResolution);
  const activity = useAgentStore((s) => s.buildActivity);

  const candidates = useMemo(() => makeCandidates(CANDIDATE_COUNT), []);
  const ids = useMemo(() => candidates.map((c) => c.id), [candidates]);
  const { eliminated, winner } = useElimination(ids, fastForward);
  const winnerCand = candidates.find((c) => c.id === winner) ?? candidates[0]!;

  const role = behaviorCore?.identity?.role ?? null;
  const mission = behaviorCore?.mission ?? null;
  const capTitles = useMemo(
    () => capabilityOrder.map((id) => capabilities[id]?.title).filter((x): x is string => !!x),
    [capabilityOrder, capabilities],
  );
  const connectorNames = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const c of personaResolution.connectors ?? []) {
      const key = (c.service_type || c.name || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(c.service_type || c.name);
    }
    return out;
  }, [personaResolution]);

  return (
    <div className="relative w-full flex flex-col items-center overflow-hidden rounded-modal" style={{ minHeight: 560 }} data-testid="cinema-stage">
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{ width: 640, height: 640, background: `radial-gradient(circle, ${colorWithAlpha(winnerCand.color, 0.10)}, transparent 62%)` }}
      />

      <div className="relative z-10 mt-4 mb-3 flex flex-col items-center gap-1 text-center px-4">
        <span className="typo-label text-foreground">{winner ? "Assembling capabilities" : "Casting a persona"}</span>
        <AnimatePresence mode="wait">
          {activity && (
            <motion.span
              key={activity}
              initial={{ opacity: 0, y: -3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 3 }}
              transition={{ duration: 0.25 }}
              className="typo-caption max-w-[440px] truncate"
            >
              {activity}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {!winner ? (
          <motion.div key="casting" exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="relative z-10 w-full flex flex-col items-center gap-5">
            <CastingBar fastForward={fastForward} />
            <EliminationCrowd candidates={candidates} eliminated={eliminated} />
          </motion.div>
        ) : (
          <motion.div key="capability" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="relative z-10 w-full">
            <CapabilityAct
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

/** Hard 30s left→right progress bar (the casting duration). */
function CastingBar({ fastForward }: { fastForward: boolean }) {
  return (
    <div className="w-full max-w-[520px] px-4">
      <div className="h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden">
        <motion.span
          className="block h-full rounded-full bg-primary"
          initial={{ width: "0%" }}
          animate={{ width: "100%" }}
          transition={{ duration: fastForward ? 0.5 : CASTING_MS / 1000, ease: "linear" }}
        />
      </div>
    </div>
  );
}

/** The crowd — silhouettes discarded one-by-one (colour drains, dims, shrinks). */
function EliminationCrowd({ candidates, eliminated }: { candidates: Candidate[]; eliminated: string[] }) {
  return (
    <div className="flex flex-wrap items-end justify-center gap-x-4 gap-y-3 max-w-[760px] mx-auto px-4 pb-4">
      {candidates.map((c) => {
        const dead = eliminated.includes(c.id);
        return (
          <motion.div
            key={c.id}
            layout
            layoutId={`cand-${c.id}`}
            initial={{ opacity: 0, y: 14, scale: 0.7 }}
            animate={{ opacity: dead ? 0.28 : 1, y: 0, scale: dead ? 0.78 : 1, filter: dead ? "grayscale(1)" : "grayscale(0)" }}
            transition={{ duration: 0.5, ease: EASE }}
            className="flex items-center justify-center rounded-full"
            style={{ width: 52, height: 52, background: dead ? "transparent" : `radial-gradient(circle at 50% 30%, ${colorWithAlpha(c.color, 0.16)}, transparent 72%)` }}
          >
            <Silhouette form={c.form} color={c.color} size={38} dead={dead} />
          </motion.div>
        );
      })}
    </div>
  );
}

/** Distinct assembly act — capability cards + connector icons stream in on a beat. */
function CapabilityAct({
  winner, agentName, role, mission, capTitles, connectors, fastForward,
}: {
  winner: Candidate; agentName: string; role: string | null; mission: string | null;
  capTitles: string[]; connectors: string[]; fastForward: boolean;
}) {
  const accent = winner.color;
  const shownCaps = useTimedReveal(capTitles, REVEAL_INTERVAL_MS, fastForward);
  const shownConnectors = useTimedReveal(connectors, REVEAL_INTERVAL_MS, fastForward);
  const capsPending = shownCaps.length === 0;

  return (
    <div className="w-full max-w-[720px] mx-auto flex flex-col items-center gap-5">
      {/* winner up top — flown in from its elimination slot */}
      <div className="flex flex-col items-center gap-1.5">
        <motion.span
          layoutId={`cand-${winner.id}`}
          className="flex items-center justify-center rounded-full"
          style={{ width: 64, height: 64, background: `radial-gradient(circle at 50% 30%, ${colorWithAlpha(accent, 0.26)}, transparent 72%)`, border: `1px solid ${colorWithAlpha(accent, 0.45)}` }}
        >
          <Silhouette form={winner.form} color={accent} size={48} />
        </motion.span>
        <span className="typo-title-lg text-foreground">{agentName?.trim() || "Your agent"}</span>
        {role && <span className="typo-caption" style={{ color: accent }}>{role}</span>}
        {mission && <span className="typo-caption text-foreground/80 max-w-[420px] text-center line-clamp-2">{mission}</span>}
      </div>

      {/* capabilities assembling */}
      <div className="w-full flex flex-col items-center gap-2">
        <span className="typo-label text-foreground">Capabilities</span>
        <div className="w-full flex flex-col items-stretch gap-2 max-w-[460px]">
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
          {capsPending && (
            <div className="flex items-center gap-2 justify-center py-2 typo-caption">
              <Cpu className="w-3.5 h-3.5 text-primary" />
              <span>Discovering capabilities…</span>
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
            {shownConnectors.length === 0 && (
              <span className="inline-flex items-center gap-1.5 typo-caption"><Plug className="w-3.5 h-3.5 text-primary" />Wiring connectors…</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
