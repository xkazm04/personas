/** GlyphCinemaLayout — "Cinema": the Glyph Full compose + a build-loading cinema.
 *
 *  Compose IS GlyphFullLayout (the flagship CommandPanel) — Cinema adds the
 *  loading experience on top. The differentiator plays during the >60s build
 *  between launch and the first clarifying question, choreographed over the
 *  ACTUAL build event stream:
 *
 *  Movement 1 — Casting (elimination): a crowd of abstract persona silhouettes
 *  (many rows, varied forms + colours) is discarded one-by-one — each drains to
 *  greyscale — with an animated scanner leading into every cut. Paced to fill
 *  ~30s, held at finalists until the LLM commits the persona identity.
 *
 *  Movement 2 — Population: the survivor moves into the view and its content
 *  fills in LINEARLY from real streamed data — decided role + mission, real
 *  capability titles row-by-row, real connectors; sigil petals light per live
 *  cellStates; a linear bar tracks real completeness.
 *
 *  Fast-forward: if the first question arrives before the cinema has run its
 *  course, it snap-crowns a winner and quick-populates, then hands off to the
 *  question surface (GlyphStageSurface) after a short beat.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { InteractiveSigil, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphRow, GlyphPresence, GlyphDimension } from "@/features/shared/glyph";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { DIM_TO_CELL_KEY } from "./glyphLayoutHelpers";
import { GlyphTopBar } from "./GlyphTopBar";
import { GlyphFullLayout } from "./GlyphFullLayout";
import { GlyphStageSurface } from "./GlyphStageSurface";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

const EASE = [0.16, 1, 0.3, 1] as const;

export function GlyphCinemaLayout(props: GlyphFullLayoutProps) {
  const { hasDesignResult, pendingQuestions, isBuilding, buildPhase, agentName, onAgentNameChange, completeness, cellStates } = props;

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const isCompose = buildSessionId === null && !hasDesignResult;
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const inBuild = buildSessionId !== null && !hasDesignResult;

  // The cinema plays for the FIRST build wait only (launch → first question).
  // Latch once a question is seen so later resolving rounds go to the stage.
  const [firstQuestionSeen, setFirstQuestionSeen] = useState(false);
  const [fastForward, setFastForward] = useState(false);
  useEffect(() => { setFirstQuestionSeen(false); setFastForward(false); }, [buildSessionId]);
  useEffect(() => {
    if (hasPending && !firstQuestionSeen) {
      setFastForward(true);
      const h = window.setTimeout(() => setFirstQuestionSeen(true), 1400);
      return () => clearTimeout(h);
    }
  }, [hasPending, firstQuestionSeen]);

  // Only the genuine first-wait window (before any question) is cinematic —
  // `initializing`/`analyzing`. Later `resolving` rounds (after an answer) go
  // straight to the stage; the fastForward beat keeps the cinema up briefly
  // while it snap-crowns and hands off.
  const isFirstWait = buildPhase === "initializing" || buildPhase === "analyzing";
  const showCinema = inBuild && !firstQuestionSeen && (isFirstWait || fastForward);

  // Compose is the flagship Glyph Full surface, verbatim.
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

// Varied person-like silhouette forms (head radius, head y, torso half-width).
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
  return Array.from({ length: n }, (_, i) => ({
    id: `p-${i}`,
    form: i % FORMS.length,
    color: PALETTE[i % PALETTE.length]!,
  }));
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
const ELIMINATION_INTERVAL_MS = 1050; // one silhouette discarded per beat
const CROWN_DEADLINE_MS = 46000;

interface CinemaStageProps {
  agentName: string;
  completeness: number;
  cellStates: Record<string, string>;
  fastForward: boolean;
}

const RESOLVED_CELL = new Set(["resolved", "updated", "highlighted"]);

function useSigilRow(cellStates: Record<string, string>): GlyphRow {
  return useMemo(() => {
    const presence = {} as Record<GlyphDimension, GlyphPresence>;
    for (const d of GLYPH_DIMENSIONS) {
      presence[d] = RESOLVED_CELL.has(cellStates[DIM_TO_CELL_KEY[d]] ?? "") ? "linked" : "none";
    }
    return { id: "building", title: "Assembling", enabled: true, triggers: [], connectors: [], steps: [], events: [], presence, shared: false };
  }, [cellStates]);
}

/** Narrow the crowd one-by-one on a beat, holding at 2 until `canCrown`; a
 *  fast-forward cuts straight to the winner (ids[0]). */
function useElimination(ids: string[], canCrown: boolean, fastForward: boolean) {
  const [eliminated, setEliminated] = useState<string[]>([]);
  const crownRef = useRef(false);
  useEffect(() => { if (canCrown) crownRef.current = true; }, [canCrown]);
  useEffect(() => { setEliminated([]); crownRef.current = false; }, [ids]);
  useEffect(() => {
    if (!fastForward) return;
    setEliminated(ids.slice(1)); // keep only the winner
  }, [fastForward, ids]);
  useEffect(() => {
    if (fastForward) return;
    const iv = window.setInterval(() => {
      setEliminated((prev) => {
        const remaining = ids.filter((i) => !prev.includes(i));
        if (remaining.length <= 1) return prev;
        if (remaining.length <= 2 && !crownRef.current) return prev;
        const last = remaining[remaining.length - 1];
        return last ? [...prev, last] : prev;
      });
    }, ELIMINATION_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [ids, fastForward]);
  const survivors = ids.filter((i) => !eliminated.includes(i));
  return { eliminated, survivors, winner: survivors.length === 1 ? survivors[0] : null };
}

function CinemaStage({ agentName, completeness, cellStates, fastForward }: CinemaStageProps) {
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const capabilities = useAgentStore((s) => s.buildCapabilities);
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const personaResolution = useAgentStore((s) => s.buildPersonaResolution);
  const activity = useAgentStore((s) => s.buildActivity);

  const [deadlineHit, setDeadlineHit] = useState(false);
  useEffect(() => {
    const h = window.setTimeout(() => setDeadlineHit(true), CROWN_DEADLINE_MS);
    return () => clearTimeout(h);
  }, []);

  const candidates = useMemo(() => makeCandidates(CANDIDATE_COUNT), []);
  const ids = useMemo(() => candidates.map((c) => c.id), [candidates]);
  const hasCore = behaviorCore != null;
  const { eliminated, survivors, winner } = useElimination(ids, hasCore || deadlineHit, fastForward);
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

  const sigilRow = useSigilRow(cellStates);

  return (
    <div className="relative w-full flex flex-col items-center overflow-hidden rounded-modal" style={{ minHeight: 560 }} data-testid="cinema-stage">
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{ width: 640, height: 640, background: `radial-gradient(circle, ${colorWithAlpha(winnerCand.color, 0.10)}, transparent 62%)` }}
      />

      <div className="relative z-10 mt-4 mb-3 flex flex-col items-center gap-1 text-center px-4">
        <span className="typo-label text-foreground">{winner ? "Assembling your agent" : "Casting a persona"}</span>
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
          <motion.div key="casting" exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="relative z-10 w-full flex flex-col items-center gap-4">
            <ScannerBar remaining={survivors.length} total={ids.length} />
            <EliminationCrowd candidates={candidates} eliminated={eliminated} />
          </motion.div>
        ) : (
          <motion.div
            key="populate"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="relative z-10 w-full"
          >
            <PopulationView
              winner={winnerCand}
              agentName={agentName}
              role={role}
              mission={mission}
              capTitles={capTitles}
              connectors={connectorNames}
              completeness={completeness}
              sigilRow={sigilRow}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** A looping scanner that fills the beat between discards, plus a live count. */
function ScannerBar({ remaining, total }: { remaining: number; total: number }) {
  return (
    <div className="w-full max-w-[520px] flex flex-col gap-1 px-4">
      <div className="h-1 w-full rounded-full bg-foreground/10 overflow-hidden">
        <motion.span
          className="block h-full w-1/3 rounded-full bg-primary/70"
          animate={{ x: ["-40%", "340%"] }}
          transition={{ duration: ELIMINATION_INTERVAL_MS / 1000, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>
      <span className="typo-caption text-center tabular-nums">
        {remaining} of {total} candidates remain
      </span>
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
            style={{
              width: 52, height: 52,
              background: dead ? "transparent" : `radial-gradient(circle at 50% 30%, ${colorWithAlpha(c.color, 0.16)}, transparent 72%)`,
            }}
          >
            <Silhouette form={c.form} color={c.color} size={38} dead={dead} />
          </motion.div>
        );
      })}
    </div>
  );
}

/** Winner moves in; content fills LINEARLY from real streamed data. */
function PopulationView({
  winner, agentName, role, mission, capTitles, connectors, completeness, sigilRow,
}: {
  winner: Candidate;
  agentName: string;
  role: string | null;
  mission: string | null;
  capTitles: string[];
  connectors: string[];
  completeness: number;
  sigilRow: GlyphRow;
}) {
  const accent = winner.color;
  return (
    <div className="w-full max-w-[860px] mx-auto rounded-modal border bg-card-bg shadow-elevation-2 overflow-hidden" style={{ borderColor: colorWithAlpha(accent, 0.35) }}>
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />

      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <motion.span
          layoutId={`cand-${winner.id}`}
          className="flex items-center justify-center rounded-full shrink-0"
          style={{ width: 48, height: 48, background: `radial-gradient(circle at 50% 30%, ${colorWithAlpha(accent, 0.22)}, transparent 72%)` }}
        >
          <Silhouette form={winner.form} color={accent} size={38} />
        </motion.span>
        <div className="min-w-0">
          <div className="typo-title-lg text-foreground truncate">{agentName?.trim() || "Your agent"}</div>
          <TextOrSkeleton value={role} className="typo-caption" style={{ color: accent }} w={160} />
        </div>
      </div>

      <div className="flex gap-5 px-5 pb-5">
        <div className="relative shrink-0 hidden md:block" style={{ width: 220, height: 220 }}>
          <InteractiveSigil row={sigilRow} rowIndex={0} hoveredDim={null} activeDim={null} onHover={() => {}} onClick={() => {}} size={220} />
        </div>

        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="typo-label text-foreground">Mission</span>
            <TextOrSkeleton value={mission} className="typo-body text-foreground" w={280} lines={2} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="typo-label text-foreground">Capabilities</span>
            <PopulatingList items={capTitles} accent={accent} placeholders={3} />
          </div>

          {connectors.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <span className="typo-label text-foreground">Connectors</span>
              <div className="flex flex-wrap gap-1.5">
                <AnimatePresence>
                  {connectors.map((name) => {
                    const meta = getConnectorMeta(name);
                    return (
                      <motion.span
                        key={name}
                        layout
                        initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.3, ease: EASE }}
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
        </div>
      </div>

      <div className="px-5 pb-4">
        <div className="h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden">
          <motion.span className="block h-full rounded-full" style={{ background: accent }} animate={{ width: `${Math.max(4, Math.round(completeness))}%` }} transition={{ duration: 0.8, ease: EASE }} />
        </div>
      </div>
    </div>
  );
}

function PopulatingList({ items, accent, placeholders }: { items: string[]; accent: string; placeholders: number }) {
  const pending = Math.max(0, placeholders - items.length);
  return (
    <div className="flex flex-col gap-1.5">
      <AnimatePresence initial={false}>
        {items.map((title) => (
          <motion.div
            key={title}
            layout
            initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: EASE }}
            className="flex items-center gap-2"
          >
            <span className="w-4 h-4 rounded-full flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(accent, 0.2) }}>
              <Check className="w-2.5 h-2.5" style={{ color: accent }} />
            </span>
            <span className="typo-body text-foreground truncate">{title}</span>
          </motion.div>
        ))}
      </AnimatePresence>
      {Array.from({ length: pending }).map((_, i) => (
        <div key={`sk-${i}`} className="flex items-center gap-2">
          <span className="w-4 h-4 rounded-full bg-foreground/10 shrink-0" />
          <motion.span
            className="h-3 rounded bg-foreground/10"
            style={{ width: `${60 - i * 10}%` }}
            animate={{ opacity: [0.4, 0.7, 0.4] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
          />
        </div>
      ))}
    </div>
  );
}

function TextOrSkeleton({
  value, className, style, w, lines = 1,
}: { value: string | null; className?: string; style?: React.CSSProperties; w: number; lines?: number }) {
  if (value) return <span className={className} style={style}>{value}</span>;
  return (
    <span className="flex flex-col gap-1">
      {Array.from({ length: lines }).map((_, i) => (
        <motion.span
          key={i}
          className="h-3 rounded bg-foreground/10"
          style={{ width: i === lines - 1 ? w * 0.7 : w }}
          animate={{ opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut", delay: i * 0.2 }}
        />
      ))}
    </span>
  );
}
