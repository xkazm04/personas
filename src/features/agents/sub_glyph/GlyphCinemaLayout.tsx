/** GlyphCinemaLayout — "Cinema": the Glyph baseline + a build-loading cinema.
 *
 *  Compose is the baseline Glyph sigil surface (petals configure; center prompt
 *  launches) — Cinema adds ON TOP of it. The differentiator is what plays during
 *  the >60s build between launch and the first clarifying question: instead of a
 *  spinner, a two-movement, semi-real loading cinema choreographed over the
 *  ACTUAL build event stream.
 *
 *  Movement 1 — Casting (elimination): a field of abstract persona candidates is
 *  narrowed one-by-one (discarded → greyed out), paced to the real wait, and the
 *  survivor is crowned the moment the LLM commits the persona's identity
 *  (behaviorCore). No sparks/waves — the drama is card movement + colour draining
 *  from the discarded.
 *
 *  Movement 2 — Population: the winner moves into the view and its content fills
 *  in LINEARLY from real data as it streams — decided role + mission, then the
 *  real capability titles row-by-row, then the real connectors; the Glyph sigil
 *  petals light per the live cellStates and a linear bar tracks real completeness.
 *
 *  Post-build delegates to the shared GlyphStageSurface.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Check } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { InteractiveSigil, GLYPH_DIMENSIONS } from "@/features/shared/glyph";
import type { GlyphRow, GlyphPresence, GlyphDimension } from "@/features/shared/glyph";
import { listArchetypes, type Archetype } from "@/api/archetypes";
import { foundryIcon } from "@/features/personas/sub_foundry/foundryIcons";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { silentCatch } from "@/lib/silentCatch";
import { useTranslation } from "@/i18n/useTranslation";
import { DIM_TO_CELL_KEY } from "./glyphLayoutHelpers";
import { GlyphTopBar } from "./GlyphTopBar";
import { GlyphStageSurface } from "./GlyphStageSurface";
import { useComposeConfig } from "./useComposeConfig";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

const EASE = [0.16, 1, 0.3, 1] as const;
const SIGIL = 300;

export function GlyphCinemaLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, launchDisabled,
    isBuilding, buildPhase, completeness, cellStates, agentName, onAgentNameChange,
    hasDesignResult, pendingQuestions,
    onQuickConfigChange, initialNotificationChannels,
  } = props;

  const { t } = useTranslation();
  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const isCompose = buildSessionId === null && !hasDesignResult;
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const isBuildingOnly = isBuilding && !hasPending;

  const cfg = useComposeConfig({
    intentText, onIntentChange, onLaunch, onQuickConfigChange,
    initialNotificationChannels, resetKey: buildSessionId,
  });

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!launchDisabled) cfg.launch();
    }
  };

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1" data-testid="build-layout-cinema">
      <div className="flex flex-col items-center pb-14 pt-4">
        <div className="w-full max-w-[1200px] flex flex-col items-center gap-3">
          <GlyphTopBar
            agentName={agentName}
            onAgentNameChange={onAgentNameChange}
            isPreBuild={isCompose}
            isBuilding={isBuilding}
            buildPhase={buildPhase}
            face="glyph"
            onFaceChange={() => {}}
            editLocked={hasPending}
          />

          {isBuildingOnly ? (
            <CinemaStage agentName={agentName} completeness={completeness} cellStates={cellStates} formingRow={cfg.formingRow} />
          ) : isCompose ? (
            /* Baseline Glyph compose — sigil petals configure, centre prompt launches. */
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="relative"
              style={{ width: SIGIL, height: SIGIL }}
            >
              <InteractiveSigil
                row={cfg.formingRow}
                rowIndex={0}
                hoveredDim={null}
                activeDim={null}
                onHover={() => {}}
                onClick={(dim) => {
                  const it = cfg.items.find((x) => x.dim === dim);
                  if (it && it.kind !== "input") it.onClick();
                }}
                size={SIGIL}
              />
              {cfg.showInput && (
                <div className="absolute left-1/2 -translate-x-1/2 z-20" style={{ top: SIGIL * 0.36, width: SIGIL * 0.74 }}>
                  <div
                    className="rounded-modal bg-card-bg/85 backdrop-blur-md border border-card-border p-3 flex flex-col gap-2 shadow-elevation-2"
                    style={{ boxShadow: "0 0 22px rgba(96,165,250,0.22), 0 4px 18px rgba(0,0,0,0.35)" }}
                  >
                    <textarea
                      value={intentText}
                      onChange={(e) => onIntentChange(e.target.value)}
                      onKeyDown={onKey}
                      placeholder={t.agents.glyph_intent_placeholder}
                      rows={3}
                      autoFocus
                      className="w-full px-3 py-2 rounded-card bg-secondary/30 border border-border/30 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none resize-none"
                      data-testid="agent-intent-input"
                    />
                    <button
                      type="button"
                      onClick={cfg.launch}
                      disabled={launchDisabled}
                      className="self-end inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card border border-primary/40 bg-primary/15 text-foreground hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer typo-body transition-colors"
                      data-testid="agent-launch-btn"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {t.agents.glyph_launch}
                    </button>
                  </div>
                </div>
              )}
            </motion.div>
          ) : (
            <GlyphStageSurface {...props} />
          )}
        </div>
      </div>

      {cfg.modals}
    </div>
  );
}

/* ─── The loading cinema ────────────────────────────────────────────── */

// Abstract persona candidate pool. Real archetypes replace this on mount; the
// fallback keeps the elimination rich even offline / in tests. Represented
// abstractly (colour + glyph + codename) — not detailed cards.
const CANDIDATE_POOL: Archetype[] = [
  { id: "analyst", name: "Analyst", tagline: "", icon: "LineChart", color: "#60A5FA", recipeAffinity: [], persona: {} },
  { id: "operator", name: "Operator", tagline: "", icon: "Workflow", color: "#818CF8", recipeAffinity: [], persona: {} },
  { id: "scout", name: "Scout", tagline: "", icon: "Radar", color: "#F59E0B", recipeAffinity: [], persona: {} },
  { id: "guardian", name: "Guardian", tagline: "", icon: "ShieldCheck", color: "#10B981", recipeAffinity: [], persona: {} },
  { id: "sentinel", name: "Sentinel", tagline: "", icon: "Activity", color: "#F87171", recipeAffinity: [], persona: {} },
  { id: "curator", name: "Curator", tagline: "", icon: "LibraryBig", color: "#A78BFA", recipeAffinity: [], persona: {} },
  { id: "shipper", name: "Shipper", tagline: "", icon: "Rocket", color: "#FB923C", recipeAffinity: [], persona: {} },
  { id: "chief-of-staff", name: "Chief of Staff", tagline: "", icon: "ConciergeBell", color: "#2DD4BF", recipeAffinity: [], persona: {} },
];

const ELIMINATION_INTERVAL_MS = 5200; // one candidate discarded per beat
const CROWN_DEADLINE_MS = 46000;      // crown even if identity is slow to land

interface CinemaStageProps {
  agentName: string;
  completeness: number;
  cellStates: Record<string, string>;
  formingRow: GlyphRow;
}

const RESOLVED_CELL = new Set(["resolved", "updated", "highlighted"]);

/** Build a sigil row from the LIVE build cellStates so petals light exactly as
 *  the backend resolves each dimension. Falls back to the compose presets. */
function useSigilRow(cellStates: Record<string, string>, fallback: GlyphRow): GlyphRow {
  return useMemo(() => {
    const presence = {} as Record<GlyphDimension, GlyphPresence>;
    let any = false;
    for (const d of GLYPH_DIMENSIONS) {
      const resolved = RESOLVED_CELL.has(cellStates[DIM_TO_CELL_KEY[d]] ?? "");
      presence[d] = resolved ? "linked" : "none";
      if (resolved) any = true;
    }
    if (!any) return fallback;
    return { id: "building", title: "Assembling", enabled: true, triggers: [], connectors: [], steps: [], events: [], presence, shared: false };
  }, [cellStates, fallback]);
}

/** Narrow a candidate list one-by-one on a timed beat, holding at 2 until
 *  `canCrown` (real identity landed, or deadline), then cutting to the winner.
 *  Winner is the first pool entry — abstract; it gains the real identity next. */
function useElimination(ids: string[], canCrown: boolean) {
  const [eliminated, setEliminated] = useState<string[]>([]);
  const crownRef = useRef(false);
  useEffect(() => { if (canCrown) crownRef.current = true; }, [canCrown]);
  useEffect(() => {
    setEliminated([]);
    crownRef.current = false;
    const iv = window.setInterval(() => {
      setEliminated((prev) => {
        const remaining = ids.filter((i) => !prev.includes(i));
        if (remaining.length <= 1) return prev;
        // Hold the field at two finalists until the identity is committed.
        if (remaining.length <= 2 && !crownRef.current) return prev;
        const last = remaining[remaining.length - 1];
        return last ? [...prev, last] : prev;
      });
    }, ELIMINATION_INTERVAL_MS);
    return () => clearInterval(iv);
  }, [ids]);
  const survivors = ids.filter((i) => !eliminated.includes(i));
  return { eliminated, survivors, winner: survivors.length === 1 ? survivors[0] : null };
}

function CinemaStage({ agentName, completeness, cellStates, formingRow }: CinemaStageProps) {
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const capabilities = useAgentStore((s) => s.buildCapabilities);
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const personaResolution = useAgentStore((s) => s.buildPersonaResolution);
  const activity = useAgentStore((s) => s.buildActivity);

  const [pool, setPool] = useState<Archetype[]>(CANDIDATE_POOL);
  const [deadlineHit, setDeadlineHit] = useState(false);

  useEffect(() => {
    listArchetypes()
      .then((cat) => { if (cat?.archetypes?.length) setPool(cat.archetypes.slice(0, 8)); })
      .catch(silentCatch("cinema:list_archetypes"));
  }, []);
  useEffect(() => {
    const h = window.setTimeout(() => setDeadlineHit(true), CROWN_DEADLINE_MS);
    return () => clearTimeout(h);
  }, []);

  const ids = useMemo(() => pool.map((p) => p.id), [pool]);
  const hasCore = behaviorCore != null;
  const { eliminated, winner } = useElimination(ids, hasCore || deadlineHit);
  const winnerArch: Archetype = (pool.find((p) => p.id === winner) ?? pool[0])!;

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

  const sigilRow = useSigilRow(cellStates, formingRow);

  return (
    <div className="relative w-full flex flex-col items-center overflow-hidden rounded-modal" style={{ minHeight: 560 }} data-testid="cinema-stage">
      {/* subtle static field — no spin, no sparks */}
      <div
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full pointer-events-none"
        style={{ width: 620, height: 620, background: `radial-gradient(circle, ${colorWithAlpha(winnerArch.color, 0.10)}, transparent 62%)` }}
      />

      {/* caption + real streaming activity */}
      <div className="relative z-10 mt-4 mb-2 flex flex-col items-center gap-0.5 text-center px-4">
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
          <motion.div key="casting" exit={{ opacity: 0 }} transition={{ duration: 0.4 }} className="relative z-10 w-full">
            <EliminationField pool={pool} eliminated={eliminated} />
          </motion.div>
        ) : (
          <motion.div
            key="populate"
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="relative z-10 w-full"
          >
            <PopulationView
              winner={winnerArch}
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

/** The candidate field — abstract orbs discarded one-by-one (colour drains, dims). */
function EliminationField({ pool, eliminated }: { pool: Archetype[]; eliminated: string[] }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-5 max-w-[820px] mx-auto px-4 py-6">
      {pool.map((a) => {
        const Icon = foundryIcon(a.icon);
        const dead = eliminated.includes(a.id);
        return (
          <motion.div
            key={a.id}
            layout
            layoutId={`cand-${a.id}`}
            initial={{ opacity: 0, y: 18, scale: 0.85 }}
            animate={{
              opacity: dead ? 0.22 : 1,
              y: 0,
              scale: dead ? 0.82 : 1,
              filter: dead ? "grayscale(1)" : "grayscale(0)",
            }}
            transition={{ duration: 0.55, ease: EASE }}
            className="flex flex-col items-center gap-2"
          >
            <span
              className="flex items-center justify-center rounded-full"
              style={{
                width: 76, height: 76,
                background: `radial-gradient(circle at 50% 35%, ${colorWithAlpha(a.color, dead ? 0.05 : 0.28)}, ${colorWithAlpha(a.color, dead ? 0.02 : 0.08)} 70%)`,
                border: `1px solid ${colorWithAlpha(a.color, dead ? 0.15 : 0.5)}`,
                boxShadow: dead ? "none" : `0 0 20px ${colorWithAlpha(a.color, 0.22)}`,
              }}
            >
              <Icon className="w-6 h-6" style={{ color: dead ? "var(--muted-foreground)" : a.color }} />
            </span>
            <span className="typo-caption font-medium" style={{ color: dead ? "var(--muted-foreground)" : "var(--foreground)" }}>
              {a.name}
            </span>
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
  winner: Archetype;
  agentName: string;
  role: string | null;
  mission: string | null;
  capTitles: string[];
  connectors: string[];
  completeness: number;
  sigilRow: GlyphRow;
}) {
  const Icon = foundryIcon(winner.icon);
  const accent = winner.color;
  return (
    <div className="w-full max-w-[860px] mx-auto rounded-modal border bg-card-bg shadow-elevation-2 overflow-hidden"
      style={{ borderColor: colorWithAlpha(accent, 0.35) }}>
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${accent}, transparent)` }} />

      {/* header — winner avatar flies in from its elimination slot */}
      <div className="flex items-center gap-3 px-5 pt-4 pb-3">
        <motion.span
          layoutId={`cand-${winner.id}`}
          className="flex items-center justify-center rounded-full shrink-0"
          style={{
            width: 48, height: 48,
            background: `radial-gradient(circle at 50% 35%, ${colorWithAlpha(accent, 0.3)}, ${colorWithAlpha(accent, 0.08)} 70%)`,
            border: `1px solid ${colorWithAlpha(accent, 0.5)}`,
          }}
        >
          <Icon className="w-5 h-5" style={{ color: accent }} />
        </motion.span>
        <div className="min-w-0">
          <div className="typo-title-lg text-foreground truncate">{agentName?.trim() || "Your agent"}</div>
          <TextOrSkeleton value={role} className="typo-caption" style={{ color: accent }} w={160} />
        </div>
      </div>

      <div className="flex gap-5 px-5 pb-5">
        {/* sigil — petals light per live cellStates */}
        <div className="relative shrink-0 hidden md:block" style={{ width: 220, height: 220 }}>
          <InteractiveSigil row={sigilRow} rowIndex={0} hoveredDim={null} activeDim={null} onHover={() => {}} onClick={() => {}} size={220} />
        </div>

        {/* linearly-populating content */}
        <div className="flex-1 min-w-0 flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <span className="typo-label text-foreground">Mission</span>
            <TextOrSkeleton value={mission} className="typo-body text-foreground" w={280} lines={2} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="typo-label text-foreground">Capabilities</span>
            <PopulatingList items={capTitles} accent={accent} placeholders={3} icon="check" />
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

      {/* linear completeness bar */}
      <div className="px-5 pb-4">
        <div className="h-1.5 w-full rounded-full bg-foreground/10 overflow-hidden">
          <motion.span
            className="block h-full rounded-full"
            style={{ background: accent }}
            animate={{ width: `${Math.max(4, Math.round(completeness))}%` }}
            transition={{ duration: 0.8, ease: EASE }}
          />
        </div>
      </div>
    </div>
  );
}

/** A list that fills row-by-row as real items stream in; shows skeleton rows
 *  for the not-yet-arrived slots so the population reads as linear progress. */
function PopulatingList({ items, accent, placeholders, icon }: { items: string[]; accent: string; placeholders: number; icon: "check" }) {
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
              {icon === "check" && <Check className="w-2.5 h-2.5" style={{ color: accent }} />}
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

/** Real text once it lands; a shimmering skeleton line until then. */
function TextOrSkeleton({
  value, className, style, w, lines = 1,
}: { value: string | null; className?: string; style?: React.CSSProperties; w: number; lines?: number }) {
  if (value) {
    return <span className={className} style={style}>{value}</span>;
  }
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
