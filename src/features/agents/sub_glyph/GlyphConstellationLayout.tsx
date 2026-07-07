/** GlyphConstellationLayout — compose-surface prototype "Constellation" (2026-07-07).
 *
 *  Metaphor: the option space is a field you navigate, not a list you scroll.
 *  The forming persona sits at the centre; candidate recipes orbit it as nodes
 *  whose distance encodes fit — the better a recipe matches the typed intent,
 *  the closer it's pulled in (intent = gravity). The eight dimensions are the
 *  sigil's petals; clicking one configures it. This directly attacks "there are
 *  too many options to choose from" by making the whole shortlist visible and
 *  spatially ranked, re-sorting live as the user types.
 *
 *  Diverges from the baseline (single central sigil + textarea) and from
 *  Dialogue (linear conversation) by rendering the DECISION FIELD itself.
 *  Post-compose it delegates to the shared GlyphStageSurface.
 */
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import { useAgentStore } from "@/stores/agentStore";
import { InteractiveSigil } from "@/features/shared/glyph";
import { useTranslation } from "@/i18n/useTranslation";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";
import { GlyphTopBar } from "./GlyphTopBar";
import { GlyphStageSurface } from "./GlyphStageSurface";
import { useComposeConfig, type ComposeConfigItem } from "./useComposeConfig";
import { useRecipeStarters } from "./useRecipeStarters";
import type { GlyphFullLayoutProps } from "./glyphLayoutTypes";

const EASE = [0.16, 1, 0.3, 1] as const;
const FIELD_W = 760;
const FIELD_H = 560;
const CENTER_X = FIELD_W / 2;
const CENTER_Y = FIELD_H / 2;
const SIGIL = 300;
const NODE_W = 168;
const GOLDEN = 2.399963; // radians — even angular spread for any count

interface NodePos { match: RecipeMatch; x: number; y: number; }

export function GlyphConstellationLayout(props: GlyphFullLayoutProps) {
  const {
    intentText, onIntentChange, onLaunch, launchDisabled,
    isBuilding, buildPhase, agentName, onAgentNameChange,
    hasDesignResult, pendingQuestions,
    onQuickConfigChange, initialNotificationChannels,
  } = props;

  const { t } = useTranslation();
  const buildSessionId = useAgentStore((s) => s.buildSessionId);
  const isCompose = buildSessionId === null && !hasDesignResult;
  const hasPending = (pendingQuestions?.length ?? 0) > 0;

  const cfg = useComposeConfig({
    intentText, onIntentChange, onLaunch, onQuickConfigChange,
    initialNotificationChannels, resetKey: buildSessionId,
  });
  const starters = useRecipeStarters(intentText, 6);
  const [focused, setFocused] = useState<string | null>(null);

  const launch = cfg.launch;
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!launchDisabled) launch();
    }
  };

  // Position each candidate on a ring: better fit → smaller radius (pulled in).
  // Golden-angle spread keeps any count visually balanced; sorted by score so
  // the strongest match takes the first (top) slot.
  const nodes: NodePos[] = useMemo(() => {
    const sorted = [...starters].sort((a, b) => b.score - a.score).slice(0, 6);
    return sorted.map((match, i) => {
      const angle = -Math.PI / 2 + i * GOLDEN;
      const radius = 210 + (1 - Math.max(0, Math.min(1, match.score))) * 96;
      return {
        match,
        x: CENTER_X + radius * Math.cos(angle) - NODE_W / 2,
        y: CENTER_Y + radius * Math.sin(angle) - 18,
      };
    });
  }, [starters]);

  const chips = cfg.items.filter((i) => i.kind !== "input");

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1" data-testid="build-layout-constellation">
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
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: EASE }}
              className="flex flex-col items-center gap-4 w-full"
            >
              {/* ── Decision field ──────────────────────────────────── */}
              <div className="relative" style={{ width: FIELD_W, height: FIELD_H, maxWidth: "100%" }}>
                {/* concentric orbit guides — pure decoration */}
                <div aria-hidden className="absolute inset-0 pointer-events-none flex items-center justify-center">
                  {[560, 420].map((d) => (
                    <span
                      key={d}
                      className="absolute rounded-full border border-border/15"
                      style={{ width: d, height: d }}
                    />
                  ))}
                  <span
                    className="absolute rounded-full"
                    style={{
                      width: 460, height: 460,
                      background: "radial-gradient(circle, rgba(96,165,250,0.10), transparent 62%)",
                    }}
                  />
                </div>

                {/* candidate recipe nodes */}
                <AnimatePresence>
                  {nodes.map((n) => (
                    <motion.button
                      key={n.match.recipe_id}
                      type="button"
                      layout
                      initial={{ opacity: 0, scale: 0.85 }}
                      animate={{ opacity: 1, scale: focused === n.match.recipe_id ? 1.04 : 1, x: n.x, y: n.y }}
                      exit={{ opacity: 0, scale: 0.85 }}
                      transition={{ type: "spring", stiffness: 260, damping: 30 }}
                      onClick={() => {
                        setFocused(n.match.recipe_id);
                        if (!intentText.trim()) onIntentChange(n.match.recipe_name);
                      }}
                      className="absolute top-0 left-0 flex items-center gap-2 pl-1.5 pr-2.5 py-1.5 rounded-full border bg-card-bg/90 backdrop-blur-sm cursor-pointer"
                      style={{
                        width: NODE_W,
                        borderColor: n.match.above_threshold ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.14)",
                        boxShadow: n.match.above_threshold ? "0 0 16px rgba(96,165,250,0.22)" : "0 2px 8px rgba(0,0,0,0.25)",
                      }}
                      data-testid={`constellation-node-${n.match.recipe_id}`}
                    >
                      <span
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 tabular-nums typo-caption font-semibold"
                        style={{ background: "rgba(96,165,250,0.18)", color: "var(--color-primary,#60a5fa)" }}
                      >
                        {Math.round(n.match.score * 100)}
                      </span>
                      <span className="typo-caption text-foreground truncate text-left">{n.match.recipe_name}</span>
                    </motion.button>
                  ))}
                </AnimatePresence>

                {/* forming persona at centre */}
                <div
                  className="absolute"
                  style={{ left: CENTER_X - SIGIL / 2, top: CENTER_Y - SIGIL / 2, width: SIGIL, height: SIGIL }}
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
                </div>

                {/* empty-field hint */}
                {nodes.length === 0 && (
                  <div className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 typo-caption" style={{ top: CENTER_Y + SIGIL / 2 + 6 }}>
                    <Sparkles className="w-3 h-3 text-primary" />
                    Start typing below — matching recipes will orbit in.
                  </div>
                )}
              </div>

              {/* ── Intent composer (the gravity source) ────────────── */}
              <div className="w-full max-w-[640px] rounded-modal border border-card-border bg-card-bg shadow-elevation-2 overflow-hidden">
                <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, var(--color-primary,#60a5fa), transparent)" }} />
                <div className="p-3 flex items-end gap-2">
                  <textarea
                    value={intentText}
                    onChange={(e) => onIntentChange(e.target.value)}
                    onKeyDown={onKey}
                    placeholder={t.agents.glyph_intent_placeholder}
                    rows={2}
                    autoFocus
                    className="flex-1 bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none resize-none"
                    data-testid="agent-intent-input"
                  />
                  <button
                    type="button"
                    onClick={launch}
                    disabled={launchDisabled}
                    className="inline-flex items-center justify-center w-10 h-10 rounded-full border border-primary/50 bg-primary/25 text-foreground hover:bg-primary/40 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shrink-0"
                    style={{ boxShadow: "0 0 22px rgba(96,165,250,0.3)" }}
                    data-testid="agent-launch-btn"
                    aria-label={t.agents.glyph_launch}
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* ── Dimension chips (petals also configure) ─────────── */}
              <div className="flex flex-wrap justify-center gap-2 max-w-[720px]">
                {chips.map((item) => (
                  <ConstellationChip key={item.dim} item={item} />
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

/** Compact dimension chip — mirrors the petal state as a pill affordance. */
function ConstellationChip({ item }: { item: ComposeConfigItem }) {
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
      data-testid={`constellation-chip-${item.dim}`}
    >
      <Icon className="w-3.5 h-3.5" style={{ color: item.active ? item.color : undefined }} />
      <span className="typo-caption font-medium text-foreground">{item.label}</span>
      {item.active && item.summary[0] && (
        <span className="typo-caption max-w-[120px] truncate" style={{ color: item.color }}>
          · {item.summary[0]}
        </span>
      )}
    </button>
  );
}
