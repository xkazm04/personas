/** GlyphDialogueLayout — compose-surface prototype "Dialogue" (2026-07-07).
 *
 *  Metaphor: building an agent is a guided conversation. The compose surface
 *  reads top-to-bottom as a dialogue — the app asks "what should this do?",
 *  the user answers in a prominent composer, and the remaining dimensions are
 *  offered as tunable chips rather than a wall of form rows. A forming-persona
 *  sigil + live blueprint rail on the right fills in as each dimension is set,
 *  so the multi-round gathering has a visible, animated payoff. Ranked recipe
 *  "starters" surface from the intent so the user can choose from the option
 *  space instead of staring at it.
 *
 *  Diverges from the baseline (radial single-sigil w/ center textarea) by
 *  making the CONVERSATION the layout. Post-compose it delegates to the shared
 *  GlyphStageSurface so build → test → promote is identical to every surface.
 */
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Check } from "lucide-react";
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

export function GlyphDialogueLayout(props: GlyphFullLayoutProps) {
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
  const starters = useRecipeStarters(intentText);

  const launch = cfg.launch;
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!launchDisabled) launch();
    }
  };

  // Chips: everything except the "What" input (which is the composer itself).
  const chips = cfg.items.filter((i) => i.kind !== "input");
  const activeItems = cfg.items.filter((i) => i.active && i.dim !== "task");

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto pr-1" data-testid="build-layout-dialogue">
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
              className="relative w-full flex gap-6 px-2"
            >
              {/* soft radial halo behind the panel — sibling of CommandPanel */}
              <div
                aria-hidden
                className="pointer-events-none absolute -inset-6 rounded-modal opacity-60"
                style={{ background: "radial-gradient(55% 45% at 42% 30%, rgba(96,165,250,0.16), transparent 70%)" }}
              />

              {/* ── Conversation column ─────────────────────────────── */}
              <div className="relative flex-1 min-w-0 flex flex-col gap-4">
                <ThreadLine delay={0.05}>
                  <span className="typo-body-lg text-foreground">
                    What should this agent do for you?
                  </span>
                  <span className="typo-caption block mt-0.5">
                    Describe the outcome in your words — the rest we'll tune together below.
                  </span>
                </ThreadLine>

                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE, delay: 0.12 }}
                  className="rounded-modal border border-card-border bg-card-bg shadow-elevation-2 overflow-hidden"
                >
                  <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, var(--color-primary,#60a5fa), transparent)" }} />
                  <div className="p-4 flex flex-col gap-3">
                    <textarea
                      value={intentText}
                      onChange={(e) => onIntentChange(e.target.value)}
                      onKeyDown={onKey}
                      placeholder={t.agents.glyph_intent_placeholder}
                      rows={3}
                      autoFocus
                      className="w-full bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none resize-none"
                      data-testid="agent-intent-input"
                    />

                    <AnimatePresence>
                      {starters.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.25, ease: EASE }}
                          className="flex flex-col gap-1.5"
                        >
                          <span className="typo-label text-foreground flex items-center gap-1.5">
                            <Sparkles className="w-3 h-3 text-primary" />
                            Closest existing recipes
                          </span>
                          <div className="flex flex-col gap-1.5">
                            {starters.slice(0, 3).map((m) => (
                              <StarterRow key={m.recipe_id} match={m} />
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <div className="flex items-center justify-between pt-1">
                      <span className="typo-caption">
                        <kbd className="px-1 rounded bg-foreground/10">Enter</kbd> to build ·{" "}
                        <kbd className="px-1 rounded bg-foreground/10">Shift+Enter</kbd> newline
                      </span>
                      <button
                        type="button"
                        onClick={launch}
                        disabled={launchDisabled}
                        className="inline-flex items-center gap-1.5 px-4 py-2 rounded-interactive border border-primary/50 bg-primary/20 text-foreground hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer typo-body font-medium transition-colors"
                        style={{ boxShadow: "0 0 18px rgba(96,165,250,0.25)" }}
                        data-testid="agent-launch-btn"
                      >
                        <Send className="w-3.5 h-3.5" />
                        {t.agents.glyph_launch}
                      </button>
                    </div>
                  </div>
                </motion.div>

                <ThreadLine delay={0.2}>
                  <span className="typo-body text-foreground">
                    Want to steer it before it runs? Tap any dimension.
                  </span>
                </ThreadLine>

                <div className="flex flex-wrap gap-2">
                  {chips.map((item, i) => (
                    <DialogueChip key={item.dim} item={item} index={i} />
                  ))}
                </div>
              </div>

              {/* ── Forming-persona rail ────────────────────────────── */}
              <div className="hidden lg:flex w-[300px] shrink-0 flex-col items-center gap-3">
                <div className="relative" style={{ width: 260, height: 260 }}>
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
                    size={260}
                  />
                </div>
                <div className="w-full rounded-card border border-border/20 bg-foreground/[0.03] p-3">
                  <span className="typo-label text-foreground">Blueprint</span>
                  <div className="mt-2 flex flex-col gap-1.5 min-h-[2rem]">
                    <AnimatePresence mode="popLayout">
                      {activeItems.length === 0 ? (
                        <motion.span
                          key="empty"
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="typo-caption italic"
                        >
                          Nothing set yet — smart defaults will fill the gaps.
                        </motion.span>
                      ) : (
                        activeItems.map((item) => (
                          <motion.div
                            key={item.dim}
                            layout
                            initial={{ opacity: 0, x: 8 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: 8 }}
                            transition={{ duration: 0.2, ease: EASE }}
                            className="flex items-start gap-2"
                          >
                            <Check className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: item.color }} />
                            <span className="typo-caption text-foreground">
                              <span className="font-semibold" style={{ color: item.color }}>{item.label}:</span>{" "}
                              {item.summary[0] ?? "on"}
                            </span>
                          </motion.div>
                        ))
                      )}
                    </AnimatePresence>
                  </div>
                </div>
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

/** A left-accented "assistant said" line — the conversation's connective tissue. */
function ThreadLine({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay }}
      className="flex gap-2.5 pl-1"
    >
      <span className="w-1 rounded-full bg-primary/40 shrink-0" />
      <div>{children}</div>
    </motion.div>
  );
}

/** A tunable dimension, rendered as a conversational chip. */
function DialogueChip({ item, index }: { item: ComposeConfigItem; index: number }) {
  const Icon = item.icon;
  return (
    <motion.button
      type="button"
      onClick={item.onClick}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE, delay: 0.24 + index * 0.03 }}
      className="group inline-flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-interactive border transition-colors cursor-pointer"
      style={{
        borderColor: item.active ? `${item.color}66` : "rgba(255,255,255,0.12)",
        background: item.active ? `${item.color}22` : "rgba(255,255,255,0.03)",
        boxShadow: item.active ? `0 0 12px ${item.color}22` : undefined,
      }}
      data-testid={`dialogue-chip-${item.dim}`}
    >
      <span
        className="w-6 h-6 rounded-input flex items-center justify-center shrink-0"
        style={{ background: item.active ? `${item.color}2e` : "rgba(255,255,255,0.05)" }}
      >
        <Icon className="w-3.5 h-3.5" style={{ color: item.active ? item.color : undefined }} />
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span className="typo-caption font-semibold text-foreground">{item.label}</span>
        {item.active && item.summary[0] && (
          <span className="typo-caption max-w-[180px] truncate" style={{ color: item.color }}>
            {item.summary[0]}
          </span>
        )}
      </span>
    </motion.button>
  );
}

/** A ranked recipe starter — name + fit meter. */
function StarterRow({ match }: { match: RecipeMatch }) {
  const pct = Math.round(match.score * 100);
  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-card border border-border/20 bg-foreground/[0.02]">
      <span className="typo-body text-foreground flex-1 truncate">{match.recipe_name}</span>
      <span className="w-16 h-1.5 rounded-full bg-foreground/10 overflow-hidden shrink-0">
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: match.above_threshold ? "var(--color-primary,#60a5fa)" : "rgba(255,255,255,0.3)" }}
        />
      </span>
      <span className="typo-data text-foreground tabular-nums w-9 text-right shrink-0">{pct}%</span>
    </div>
  );
}
