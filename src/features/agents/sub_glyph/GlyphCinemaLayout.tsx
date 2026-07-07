/** GlyphCinemaLayout — compose-surface prototype "Cinema" (2026-07-07).
 *
 *  The build between a submitted intent and the first clarifying question takes
 *  >60s. Every other surface shows a spinner. This one turns that dead time
 *  into a videogame-grade loading cinema that is SEMI-REAL: it choreographs
 *  over the ACTUAL build event stream — the persona's decided role/mission
 *  (behaviorCore), the real capability titles as they enumerate, and the real
 *  connectors as they resolve — not a fake progress bar.
 *
 *  Three acts play while `isBuildingOnly`, gated by real signal arrival:
 *    1. Casting  — four real archetype cards fan in with a calibration sweep;
 *       the instant the LLM's behaviorCore lands, the chosen card reveals the
 *       agent's REAL decided role + mission.
 *    2. Wiring   — the real capability titles stream in as they're enumerated;
 *       real connectors dock as brand-icon chips; sigil petals light per the
 *       real cellStates being resolved.
 *    3. Converge — everything collapses into the sigil; the ring fills to real
 *       completeness until the first question arrives and the parent hands off
 *       to GlyphStageSurface.
 *
 *  Compose reuses the sigil surface (baseline Glyph); post-build delegates to
 *  the shared GlyphStageSurface.
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Check, Sparkles, Cpu } from "lucide-react";
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
import { useComposeConfig, type ComposeConfigItem } from "./useComposeConfig";
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
            <CinemaStage
              agentName={agentName}
              completeness={completeness}
              cellStates={cellStates}
              items={cfg.items}
              formingRow={cfg.formingRow}
            />
          ) : isCompose ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex flex-col items-center gap-4 w-full"
            >
              <div className="relative" style={{ width: SIGIL, height: SIGIL }}>
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
                  <div
                    className="absolute left-1/2 -translate-x-1/2 z-20"
                    style={{ top: SIGIL * 0.36, width: SIGIL * 0.74 }}
                  >
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
              </div>
              <div className="flex flex-wrap justify-center gap-2 max-w-[720px]">
                {cfg.items.filter((i) => i.kind !== "input").map((item) => (
                  <CinemaChip key={item.dim} item={item} />
                ))}
              </div>
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

type Act = "ignition" | "casting" | "wiring" | "converge";

const ACT_CAPTION: Record<Act, string> = {
  ignition: "Igniting",
  casting: "Casting a persona",
  wiring: "Wiring capabilities",
  converge: "Assembling",
};

// Graceful fallback so the cinema always has cards even before list_archetypes
// resolves (or in a test/offline run). Real archetypes replace these on mount.
const FALLBACK_ARCHETYPES: Archetype[] = [
  { id: "analyst", name: "Analyst", tagline: "Every claim cited", icon: "LineChart", color: "#60A5FA", recipeAffinity: [], persona: {} },
  { id: "operator", name: "Operator", tagline: "Never lose an event", icon: "Workflow", color: "#818CF8", recipeAffinity: [], persona: {} },
  { id: "scout", name: "Scout", tagline: "Signal over volume", icon: "Radar", color: "#F59E0B", recipeAffinity: [], persona: {} },
  { id: "guardian", name: "Guardian", tagline: "Nothing ships unverified", icon: "ShieldCheck", color: "#10B981", recipeAffinity: [], persona: {} },
];

interface CinemaStageProps {
  agentName: string;
  completeness: number;
  cellStates: Record<string, string>;
  items: ComposeConfigItem[];
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

function CinemaStage({ agentName, completeness, cellStates, formingRow }: CinemaStageProps) {
  // Live decided signals from the build stream (semi-real choreography source).
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const capabilities = useAgentStore((s) => s.buildCapabilities);
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const personaResolution = useAgentStore((s) => s.buildPersonaResolution);
  const activity = useAgentStore((s) => s.buildActivity);

  const [archetypes, setArchetypes] = useState<Archetype[]>(FALLBACK_ARCHETYPES);
  const [booted, setBooted] = useState(false);

  useEffect(() => {
    listArchetypes()
      .then((cat) => { if (cat?.archetypes?.length) setArchetypes(cat.archetypes.slice(0, 4)); })
      .catch(silentCatch("cinema:list_archetypes"));
  }, []);
  useEffect(() => {
    const h = window.setTimeout(() => setBooted(true), 1600);
    return () => clearTimeout(h);
  }, []);

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

  // Act derives from real signal arrival, with a timer only to leave ignition
  // if the build is slow to emit its first decided field.
  const act: Act =
    completeness >= 78 ? "converge"
    : capTitles.length > 0 ? "wiring"
    : (role || booted) ? "casting"
    : "ignition";

  // Choose the archetype whose id/name best matches the decided role text, else
  // a stable pick — so the "cast" feels caused by the real persona.
  const chosenIdx = useMemo(() => {
    const cast = archetypes.slice(0, 4);
    if (role) {
      const r = role.toLowerCase();
      const hit = cast.findIndex((a) => r.includes(a.id) || r.includes(a.name.toLowerCase()));
      if (hit >= 0) return hit;
    }
    const s = (mission || agentName || "agent").toLowerCase();
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h % Math.max(1, Math.min(4, cast.length));
  }, [archetypes, role, mission, agentName]);

  const sigilRow = useSigilRow(cellStates, formingRow);
  const cast = archetypes.slice(0, 4);

  return (
    <div
      className="relative w-full flex flex-col items-center justify-center overflow-hidden rounded-modal"
      style={{ minHeight: 560 }}
      data-testid="cinema-stage"
    >
      {/* ambient field */}
      <div aria-hidden className="absolute inset-0 pointer-events-none">
        <div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ width: 620, height: 620, background: "radial-gradient(circle, rgba(96,165,250,0.10), transparent 62%)" }}
        />
        <motion.div
          className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/15"
          style={{ width: 460, height: 460 }}
          animate={{ rotate: 360 }}
          transition={{ duration: 44, repeat: Infinity, ease: "linear" }}
        />
      </div>

      {/* phase caption + live activity from the real stream */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-0.5 z-10 text-center px-4">
        <span className="typo-label text-foreground flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-primary" />
          {ACT_CAPTION[act]}
        </span>
        <AnimatePresence mode="wait">
          {activity && (
            <motion.span
              key={activity}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 3 }}
              transition={{ duration: 0.25 }}
              className="typo-caption max-w-[420px] truncate"
            >
              {activity}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {act === "casting" || act === "ignition" ? (
          <motion.div key="casting" className="w-full flex justify-center" exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.4, ease: EASE }}>
            <CastingAct cast={cast} chosenIdx={chosenIdx} role={role} mission={mission} />
          </motion.div>
        ) : (
          <motion.div
            key="wiring-converge"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: EASE }}
            className="relative flex flex-col items-center gap-5"
          >
            <div className="relative" style={{ width: SIGIL, height: SIGIL }}>
              <InteractiveSigil
                row={sigilRow}
                rowIndex={0}
                hoveredDim={null}
                activeDim={null}
                onHover={() => {}}
                onClick={() => {}}
                size={SIGIL}
              />
              {/* progress ring keyed to real completeness */}
              <svg className="absolute inset-0 pointer-events-none -rotate-90" width={SIGIL} height={SIGIL}>
                <circle
                  cx={SIGIL / 2} cy={SIGIL / 2} r={SIGIL / 2 - 8}
                  fill="none" stroke="var(--color-primary,#60a5fa)" strokeWidth={3} strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * (SIGIL / 2 - 8)}
                  strokeDashoffset={2 * Math.PI * (SIGIL / 2 - 8) * (1 - Math.max(0.04, completeness / 100))}
                  style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.16,1,0.3,1)", filter: "drop-shadow(0 0 6px rgba(96,165,250,0.5))" }}
                />
              </svg>
              {role && (
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex flex-col items-center px-8 text-center pointer-events-none">
                  <span className="typo-label text-primary">{role}</span>
                </div>
              )}
            </div>

            <WiringAct capTitles={capTitles} connectors={connectorNames} />

            <div className="flex flex-col items-center gap-1">
              <span className="typo-heading-lg font-semibold text-foreground">
                {agentName?.trim() || "Assembling your agent"}
              </span>
              <span className="typo-caption tabular-nums">
                {Math.round(completeness)}% · {capTitles.length} capabilit{capTitles.length === 1 ? "y" : "ies"}
                {connectorNames.length > 0 ? ` · ${connectorNames.length} connector${connectorNames.length === 1 ? "" : "s"}` : ""}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Four archetype cards fan in; a calibration sweep runs; one is selected and,
 *  once the LLM's behaviorCore lands, reveals the agent's REAL role + mission. */
function CastingAct({
  cast, chosenIdx, role, mission,
}: { cast: Archetype[]; chosenIdx: number; role: string | null; mission: string | null }) {
  // Selection lands either when the real role arrives, or after a short beat so
  // the animation reads even on a fast build.
  const [timedSelect, setTimedSelect] = useState(false);
  useEffect(() => {
    const h = window.setTimeout(() => setTimedSelect(true), 4200);
    return () => clearTimeout(h);
  }, []);
  const selected = timedSelect || role != null;

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-stretch gap-3 flex-wrap justify-center max-w-[900px] px-4">
        {cast.map((a, i) => {
          const Icon = foundryIcon(a.icon);
          const isChosen = i === chosenIdx;
          const dimmed = selected && !isChosen;
          return (
            <motion.div
              key={a.id}
              initial={{ opacity: 0, y: 24, rotateY: -18 }}
              animate={{
                opacity: dimmed ? 0.22 : 1,
                y: 0, rotateY: 0,
                scale: selected && isChosen ? 1.06 : 1,
                filter: dimmed ? "grayscale(0.7)" : "none",
              }}
              transition={{ duration: 0.5, ease: EASE, delay: i * 0.12 }}
              className="relative w-[190px] p-4 rounded-card border bg-card-bg shadow-elevation-2"
              style={{
                borderColor: selected && isChosen ? colorWithAlpha(a.color, 0.6) : "var(--card-border, rgba(255,255,255,0.1))",
                boxShadow: selected && isChosen ? `0 0 26px ${colorWithAlpha(a.color, 0.35)}` : undefined,
              }}
            >
              <AnimatePresence>
                {selected && isChosen && (
                  <motion.span
                    initial={{ scale: 0 }} animate={{ scale: 1 }}
                    className="absolute top-2.5 right-2.5 inline-flex items-center justify-center w-5 h-5 rounded-full"
                    style={{ background: a.color }}
                  >
                    <Check className="w-3 h-3 text-background" />
                  </motion.span>
                )}
              </AnimatePresence>
              <span
                className="flex items-center justify-center rounded-card mb-2"
                style={{ width: 38, height: 38, background: colorWithAlpha(a.color, 0.14), border: `1px solid ${colorWithAlpha(a.color, 0.4)}` }}
              >
                <Icon className="w-4.5 h-4.5" style={{ color: a.color }} />
              </span>
              <div className="typo-body font-semibold text-foreground">{a.name}</div>
              <div className="typo-caption mb-3" style={{ color: a.color }}>{a.tagline}</div>
              <div className="flex flex-col gap-1.5">
                {[0.72, 0.48].map((v, di) => (
                  <span key={di} className="h-1.5 rounded-full bg-foreground/10 overflow-hidden">
                    <motion.span
                      className="block h-full rounded-full"
                      style={{ background: a.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.round(v * 100)}%` }}
                      transition={{ duration: 1.1, ease: EASE, delay: 0.4 + i * 0.12 + di * 0.15 }}
                    />
                  </span>
                ))}
              </div>
              {!selected && (
                <motion.span
                  aria-hidden
                  className="absolute inset-0 rounded-card pointer-events-none"
                  style={{ background: `linear-gradient(105deg, transparent 40%, ${colorWithAlpha(a.color, 0.18)} 50%, transparent 60%)` }}
                  initial={{ x: "-120%" }}
                  animate={{ x: "120%" }}
                  transition={{ duration: 1.6, repeat: Infinity, ease: "linear", delay: i * 0.12 }}
                />
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Real decided identity, revealed as the LLM commits to it. */}
      <AnimatePresence>
        {(role || mission) && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE }}
            className="max-w-[560px] text-center flex flex-col items-center gap-1"
          >
            {role && <span className="typo-title-lg text-foreground">{role}</span>}
            {mission && <span className="typo-body text-foreground/90 line-clamp-2">{mission}</span>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Real capability titles + connectors dock into the forming persona. */
function WiringAct({ capTitles, connectors }: { capTitles: string[]; connectors: string[] }) {
  return (
    <div className="flex flex-col items-center gap-2 min-h-[3.5rem] w-full max-w-[620px]">
      {capTitles.length === 0 && connectors.length === 0 ? (
        <span className="inline-flex items-center gap-1.5 typo-caption">
          <Cpu className="w-3.5 h-3.5 text-primary" />
          Selecting capabilities & connectors…
        </span>
      ) : (
        <>
          <div className="flex flex-wrap justify-center gap-1.5">
            <AnimatePresence>
              {capTitles.map((title) => (
                <motion.span
                  key={title}
                  initial={{ opacity: 0, y: 8, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 260, damping: 24 }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/40 bg-primary/15"
                >
                  <Check className="w-3 h-3 text-primary" />
                  <span className="typo-caption text-foreground max-w-[220px] truncate">{title}</span>
                </motion.span>
              ))}
            </AnimatePresence>
          </div>
          {connectors.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              <AnimatePresence>
                {connectors.map((name) => {
                  const meta = getConnectorMeta(name);
                  return (
                    <motion.span
                      key={name}
                      initial={{ opacity: 0, x: 24, scale: 0.7 }}
                      animate={{ opacity: 1, x: 0, scale: 1 }}
                      transition={{ type: "spring", stiffness: 240, damping: 22 }}
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
          )}
        </>
      )}
    </div>
  );
}

/** Compact dimension chip for the compose sigil surface. */
function CinemaChip({ item }: { item: ComposeConfigItem }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={item.onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border transition-colors cursor-pointer"
      style={{
        borderColor: item.active ? `${item.color}66` : "rgba(255,255,255,0.12)",
        background: item.active ? `${item.color}22` : "rgba(255,255,255,0.03)",
        boxShadow: item.active ? `0 0 12px ${item.color}22` : undefined,
      }}
      title={item.summary[0] ?? item.label}
      data-testid={`cinema-chip-${item.dim}`}
    >
      <Icon className="w-3.5 h-3.5" style={{ color: item.active ? item.color : undefined }} />
      <span className="typo-caption font-medium text-foreground">{item.label}</span>
    </button>
  );
}
