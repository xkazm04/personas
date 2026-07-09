/** GlyphDialogueCinemaLayout — compose-surface prototype "DialogueCinema".
 *
 *  Built on top of the Dialogue variant. Where GlyphCinemaLayout REPLACES the
 *  whole surface with a fullscreen loading cinema, this variant keeps the
 *  Dialogue brief ANCHORED ON TOP the whole time and plays the cinema as an
 *  animated addition BELOW it:
 *
 *    ┌ Dialogue brief (locked while building) ─ intent · recipe · config ┐
 *    │  …persona identity syncs UP into a header here as it streams (B2)   │
 *    ├ ── — cinema reel (animated addition) — ── ────────────────────────┤
 *    │  casting silhouettes → coronation → capability chips                │
 *    └────────────────────────────────────────────────────────────────────┘
 *
 *  The user's brief never leaves the screen; the "factory" runs underneath and
 *  its results (the matched recipe, then the real persona + capabilities) rise
 *  into the brief on top. Post-question it hands off to the shared
 *  GlyphStageSurface (sigil + metadata panel), same as every surface.
 */
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Film, Check } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { GlyphTopBar } from "./GlyphTopBar";
import { DialogueStageSurface } from "./DialogueStageSurface";
import { DialogueComposePanel } from "./DialogueComposePanel";
import { usePersonaCore, PersonaCoreModal } from "./personaCore";
import { useComposeConfig } from "./useComposeConfig";
import { useRecipeStarters } from "./useRecipeStarters";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

const EASE = [0.16, 1, 0.3, 1] as const;
const ACCENT = "#60A5FA";
const REEL_COUNT = 14;             // silhouettes in the below-content reel
const REEL_FINALISTS = 3;
const REEL_CAST_MS = 22000;
const REEL_FASTFWD_MS = 1500;      // when the build finishes early, sprint the
                                   // remaining eliminations over this window
const FINALIST_HOLD_MS = 450;      // brief pause on the finalists before crowning

export function GlyphDialogueCinemaLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, launchDisabled,
    isBuilding, buildPhase, agentName, onAgentNameChange,
    hasDesignResult, pendingQuestions,
    onQuickConfigChange, initialNotificationChannels,
  } = props;

  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const isCompose = buildSessionId === null && !hasDesignResult;
  const hasPending = (pendingQuestions?.length ?? 0) > 0;
  const postCompose = !isCompose;

  const core = usePersonaCore(buildSessionId);
  const [coreModalOpen, setCoreModalOpen] = useState(false);
  const cfg = useComposeConfig({
    intentText, onIntentChange, onLaunch, onQuickConfigChange,
    initialNotificationChannels, resetKey: buildSessionId,
    coreAugmentation: core.launchAugmentation(),
  });
  const starters = useRecipeStarters(intentText);

  const [firstQuestionSeen, setFirstQuestionSeen] = useState(false);
  useEffect(() => { setFirstQuestionSeen(false); }, [buildSessionId]);
  useEffect(() => {
    if (hasPending && !firstQuestionSeen) {
      // Give the reel time to fast-forward + crown + reveal capabilities before
      // handing off, so a fast build finishes the animation rather than cutting.
      const h = window.setTimeout(() => setFirstQuestionSeen(true), 3400);
      return () => clearTimeout(h);
    }
  }, [hasPending, firstQuestionSeen]);

  // The cinema plays only during the initial build burst — before the first
  // question lands and before any draft is ready. Everything after (questions,
  // draft_ready, test, promote) is the dialogue stage, so the user never lands
  // in the glyph sigil UI.
  const loading = postCompose && !firstQuestionSeen && !hasDesignResult;
  const role = behaviorCore?.identity?.role ?? null;
  const mission = behaviorCore?.mission ?? null;

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1" data-testid="build-layout-dialogue-cinema">
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

          {isCompose ? (
            <DialogueComposePanel
              intentText={intentText}
              onIntentChange={onIntentChange}
              onLaunch={cfg.launch}
              launchDisabled={launchDisabled}
              cfg={cfg}
              starters={starters}
              core={core}
              onOpenCore={() => setCoreModalOpen(true)}
            />
          ) : (
            /* The compose panel PERSISTS through the entire build — the brief,
               glyph, and the blueprint card (enriching into live capabilities)
               stay on top the whole time. Only the content BELOW swaps: the
               loading reel first, then the dialogue enrichment (questions →
               test → promote). No layout switch, so the initial state never
               disappears out from under the user. */
            <div className="w-full flex flex-col items-center gap-4">
              <DialogueComposePanel
                intentText={intentText}
                onIntentChange={onIntentChange}
                onLaunch={cfg.launch}
                launchDisabled
                cfg={cfg}
                starters={starters}
                locked
                composing={loading}
                syncRole={role}
                syncMission={mission}
                core={core}
                onOpenCore={() => setCoreModalOpen(true)}
              />
              {loading ? (
                <CinemaReel fastForward={hasPending} />
              ) : (
                <DialogueStageSurface {...props} />
              )}
            </div>
          )}
        </div>
      </div>

      {cfg.modals}
      <PersonaCoreModal core={core} isOpen={coreModalOpen} onClose={() => setCoreModalOpen(false)} />
    </div>
  );
}

/* ─── Cinema reel (the below-content animated addition) ──────────────── */

const FORMS = [
  { hr: 7, hy: 12, tw: 14 }, { hr: 6.4, hy: 11, tw: 12 }, { hr: 7.6, hy: 13, tw: 16 },
  { hr: 6, hy: 11, tw: 13 }, { hr: 8, hy: 13.5, tw: 15 },
] as const;
const PALETTE = ["#60A5FA", "#818CF8", "#22D3EE", "#34D399", "#FBBF24", "#FB7185", "#2DD4BF", "#A78BFA"];

interface Cand { id: string; form: number; color: string; }

function Silhouette({ form, color, size, dead }: { form: number; color: string; size: number; dead?: boolean }) {
  const f = FORMS[form] ?? FORMS[0]!;
  const c = dead ? "var(--muted-foreground)" : color;
  const shoulder = f.hy + f.hr;
  return (
    <svg viewBox="0 0 44 48" width={size} height={size} aria-hidden style={{ opacity: dead ? 0.45 : 1 }}>
      <circle cx={22} cy={f.hy} r={f.hr} fill={c} />
      <path d={`M ${22 - f.tw} 48 C ${22 - f.tw} ${shoulder + 5}, ${22 - f.tw + 2} ${shoulder}, 22 ${shoulder} C ${22 + f.tw - 2} ${shoulder}, ${22 + f.tw} ${shoulder + 5}, ${22 + f.tw} 48 Z`} fill={c} />
    </svg>
  );
}

/** Narrow to REEL_FINALISTS over REEL_CAST_MS, hold at the finalists, then crown.
 *  When `coronation` flips true early, the animation is NOT cut — it fast-forwards
 *  the remaining eliminations over REEL_FASTFWD_MS and crowns after a short hold,
 *  so a quick build still gets a complete (just sped-up) reel. */
function useReelCasting(ids: string[], coronation: boolean) {
  const maxToFloor = Math.max(0, ids.length - REEL_FINALISTS);
  const [discarded, setDiscarded] = useState(0);
  const [crowned, setCrowned] = useState(false);
  useEffect(() => { setDiscarded(0); setCrowned(false); }, [ids]);
  useEffect(() => {
    if (crowned) return;
    if (discarded >= maxToFloor) {
      // At the finalist floor — hold until coronation, then crown.
      if (!coronation) return;
      const h = window.setTimeout(() => setCrowned(true), FINALIST_HOLD_MS);
      return () => clearTimeout(h);
    }
    // Still eliminating: normal cadence, or sprint the remainder when finishing early.
    const remaining = maxToFloor - discarded;
    const step = coronation ? REEL_FASTFWD_MS / remaining : REEL_CAST_MS / Math.max(1, maxToFloor);
    const h = window.setTimeout(() => setDiscarded((d) => d + 1), step);
    return () => clearTimeout(h);
  }, [discarded, crowned, coronation, maxToFloor]);
  const keep = crowned ? 1 : ids.length - discarded;
  return {
    crowned,
    deliberating: !crowned && discarded >= maxToFloor,
    eliminated: ids.slice(keep),
    finalists: ids.slice(0, Math.max(keep, 1)),
    winner: ids[0]!,
  };
}

function CinemaReel({ fastForward }: { fastForward: boolean }) {
  const behaviorCore = useAgentStore((s) => s.buildBehaviorCore);
  const capabilities = useAgentStore((s) => s.buildCapabilities);
  const capabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const personaResolution = useAgentStore((s) => s.buildPersonaResolution);
  const activity = useAgentStore((s) => s.buildActivity);

  const cands = useMemo<Cand[]>(
    () => Array.from({ length: REEL_COUNT }, (_, i) => ({ id: `r-${i}`, form: i % FORMS.length, color: PALETTE[i % PALETTE.length]! })),
    [],
  );
  const ids = useMemo(() => cands.map((c) => c.id), [cands]);
  const hasCore = !!(behaviorCore?.identity?.role || behaviorCore?.mission);
  const { crowned, deliberating, eliminated, finalists, winner } = useReelCasting(ids, hasCore || fastForward);
  const winnerCand = cands.find((c) => c.id === winner) ?? cands[0]!;

  const capTitles = useMemo(
    () => capabilityOrder.map((id) => capabilities[id]?.title).filter((x): x is string => !!x),
    [capabilityOrder, capabilities],
  );
  const connectors = useMemo(() => {
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
    <div
      className="relative w-full rounded-modal border overflow-hidden px-4 py-5"
      style={{ borderColor: colorWithAlpha(ACCENT, 0.2), background: `radial-gradient(120% 100% at 50% 0%, ${colorWithAlpha(winnerCand.color, 0.08)}, transparent 70%)`, minHeight: 168 }}
      data-testid="dialoguecinema-reel"
    >
      <div className="flex items-center justify-center gap-2 mb-4">
        <Film className="w-3.5 h-3.5 text-primary" />
        <span className="typo-label text-foreground">
          {crowned ? "Assembling capabilities" : deliberating ? "Weighing the final candidates" : "Casting your persona"}
        </span>
        <AnimatePresence mode="wait">
          {activity && (
            <motion.span key={activity} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="typo-caption max-w-[280px] truncate">· {activity}</motion.span>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        {!crowned ? (
          <motion.div key="reel-cast" exit={{ opacity: 0 }} className="flex flex-wrap items-end justify-center gap-x-3 gap-y-2" data-testid="dialoguecinema-casting">
            {cands.map((c) => {
              const dead = eliminated.includes(c.id);
              const fin = deliberating && finalists.includes(c.id);
              return (
                <motion.div
                  key={c.id}
                  layout
                  layoutId={`reel-${c.id}`}
                  initial={{ opacity: 0, scale: 0.7 }}
                  animate={dead ? { opacity: 0.26, scale: 0.72, filter: "grayscale(1)" } : fin ? { opacity: 1, scale: 1.12, y: [0, -3, 0], filter: "grayscale(0)" } : { opacity: 1, scale: 1, filter: "grayscale(0)" }}
                  transition={fin ? { y: { duration: 1.6, repeat: Infinity, ease: "easeInOut" }, scale: { duration: 0.4 } } : { duration: 0.4, ease: EASE }}
                  className="flex items-center justify-center rounded-full"
                  style={{ width: fin ? 46 : 38, height: fin ? 46 : 38, background: dead ? "transparent" : `radial-gradient(circle at 50% 30%, ${colorWithAlpha(c.color, 0.16)}, transparent 72%)` }}
                >
                  <Silhouette form={c.form} color={c.color} size={fin ? 34 : 28} dead={dead} />
                </motion.div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div key="reel-crowned" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: EASE }} className="flex flex-col items-center gap-3" data-testid="dialoguecinema-capability">
            <motion.span
              layoutId={`reel-${winner}`}
              className="flex items-center justify-center rounded-full"
              style={{ width: 54, height: 54, background: `radial-gradient(circle at 50% 30%, ${colorWithAlpha(winnerCand.color, 0.3)}, transparent 72%)`, border: `1px solid ${colorWithAlpha(winnerCand.color, 0.5)}` }}
            >
              <Silhouette form={winnerCand.form} color={winnerCand.color} size={40} />
            </motion.span>
            {capTitles.length > 0 ? (
              <div className="flex flex-wrap justify-center gap-1.5" data-testid="dialoguecinema-cap-list">
                {capTitles.map((title) => (
                  <motion.span
                    key={title}
                    initial={{ opacity: 0, scale: 0.8, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 240, damping: 22 }}
                    className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border bg-card-bg"
                    style={{ borderColor: colorWithAlpha(winnerCand.color, 0.35) }}
                  >
                    <Check className="w-3 h-3" style={{ color: winnerCand.color }} />
                    <span className="typo-caption text-foreground">{title}</span>
                  </motion.span>
                ))}
                {connectors.map((name) => {
                  const meta = getConnectorMeta(name);
                  return (
                    <span key={name} className="inline-flex items-center gap-1 pl-1 pr-2 py-1 rounded-full border" style={{ borderColor: colorWithAlpha(meta.color, 0.4), background: colorWithAlpha(meta.color, 0.12) }}>
                      <span className="w-4 h-4 rounded-full flex items-center justify-center"><ConnectorIcon meta={meta} /></span>
                      <span className="typo-caption text-foreground">{meta.label}</span>
                    </span>
                  );
                })}
              </div>
            ) : (
              <span className="typo-caption">Composing capabilities…</span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
