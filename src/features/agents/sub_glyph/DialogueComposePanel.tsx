/** DialogueComposePanel — the Dialogue variant's compose surface, extracted so
 *  both GlyphDialogueLayout and the DialogueCinema variant share one compose
 *  experience (the conversation column + forming-persona rail).
 *
 *  Adds a `locked` mode: during a build, the DialogueCinema variant keeps this
 *  panel on top as a read-only "brief" — inputs disabled, a loading bar in place
 *  of the launch affordance, and the real persona identity (role/mission from the
 *  streamed behavior_core) syncing into a header above the brief. The plain
 *  Dialogue variant only ever renders it unlocked.
 */
import { useMemo, useState, type KeyboardEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles, Loader2, ChevronRight, Check } from "lucide-react";
import { InteractiveSigil } from "@/features/shared/glyph";
import { useAgentStore } from "@/stores/agentStore";
import { useTranslation } from "@/i18n/useTranslation";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { PersonaCoreBadge } from "./personaCore/PersonaCoreBadge";
import type { PersonaCore } from "./personaCore/usePersonaCore";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";
import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";
import { RecipeAlternativeModal } from "./RecipeAlternativeModal";
import type { useComposeConfig, ComposeConfigItem } from "./useComposeConfig";

const EASE = [0.16, 1, 0.3, 1] as const;
const ACCENT = "#60A5FA";

type Cfg = ReturnType<typeof useComposeConfig>;

export interface DialogueComposePanelProps {
  intentText: string;
  onIntentChange: (v: string) => void;
  onLaunch: () => void;
  launchDisabled: boolean;
  cfg: Cfg;
  starters: RecipeMatch[];
  /** Build in flight — lock the inputs, swap the launch row for a loading bar,
   *  hide the compose rail, and surface the syncing persona identity. */
  locked?: boolean;
  /** True only during the reel/loading sub-phase — shows the indeterminate
   *  progress bar. Once questions or the ready state take over below, it's false
   *  (the enrichment carries the live status; a spinning bar there would lie). */
  composing?: boolean;
  /** Streamed-in real identity (behavior_core) — populates the sync header when locked. */
  syncRole?: string | null;
  syncMission?: string | null;
  /** Persona-core configurator state + opener — renders the temperament badge
   *  under the intent (the slot that replaced the old "What" leaf). */
  core?: PersonaCore;
  onOpenCore?: () => void;
}

export function DialogueComposePanel({
  intentText, onIntentChange, onLaunch, launchDisabled, cfg, starters, locked = false, composing = false, syncRole = null, syncMission = null,
  core, onOpenCore,
}: DialogueComposePanelProps) {
  const { t } = useTranslation();
  const [openRecipe, setOpenRecipe] = useState<RecipeMatch | null>(null);
  const [selectedRecipeId, setSelectedRecipeId] = useState<string | null>(null);

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!launchDisabled && !locked) onLaunch();
    }
  };

  // Select-as-alternative: seed the intent from the chosen recipe so the build
  // starts from its proven shape. Prefer the description; fall back to the name.
  const selectRecipeAlternative = (recipe: RecipeDefinition) => {
    const seed = (recipe.description?.trim() || recipe.name).trim();
    if (seed) onIntentChange(seed);
    // Remember it so it doesn't re-surface as its own "faster path": the intent
    // is now the recipe's description, and the name-weighted matcher scores that
    // same recipe low (~35%), which reads as a bug rather than a match.
    setSelectedRecipeId(recipe.id);
  };

  const activeItems = cfg.items.filter((i) => i.active && i.dim !== "task");
  // Every configurable dimension except the intent itself ("task"/What) — the
  // badge row's clickable levers. The intent textarea already IS the "what".
  const dimensionItems = cfg.items.filter((i) => i.kind !== "input");
  // Drop the already-selected recipe from the suggestions (see selectRecipeAlternative).
  const shownStarters = selectedRecipeId ? starters.filter((s) => s.recipe_id !== selectedRecipeId) : starters;
  const topStarter = shownStarters[0] ?? null;
  const hasSync = locked && !!(syncRole || syncMission);

  // The blueprint card ENRICHES into live capabilities once the build produces
  // them — the initial state persists, its content just deepens (no layout swap).
  const buildCapabilities = useAgentStore((s) => s.buildCapabilities);
  const buildCapabilityOrder = useAgentStore((s) => s.buildCapabilityOrder);
  const caps = useMemo(
    () => buildCapabilityOrder.map((id) => buildCapabilities[id]).filter((c): c is NonNullable<typeof c> => !!c?.title),
    [buildCapabilityOrder, buildCapabilities],
  );
  const showCaps = locked && caps.length > 0;

  return (
    <>
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE }}
      className="relative w-full flex gap-6 px-2"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-6 rounded-modal opacity-60"
        style={{ background: "radial-gradient(55% 45% at 42% 30%, rgba(96,165,250,0.16), transparent 70%)" }}
      />

      {/* ── Conversation / brief column ─────────────────────────────── */}
      <div className="relative flex-1 min-w-0 flex flex-col gap-4">
        {/* persona identity syncs in here as behavior_core streams (locked only) */}
        <AnimatePresence>
          {hasSync && (
            <motion.div
              key="sync"
              initial={{ opacity: 0, y: -6, height: 0 }}
              animate={{ opacity: 1, y: 0, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className="flex flex-col gap-1 px-4 py-3 rounded-modal border bg-card-bg"
              style={{ borderColor: colorWithAlpha(ACCENT, 0.4), boxShadow: `0 0 22px ${colorWithAlpha(ACCENT, 0.14)}` }}
              data-testid="dialoguecinema-persona-sync"
            >
              <span className="typo-label" style={{ color: ACCENT }}>Your persona is taking shape</span>
              {syncRole && <span className="typo-body-lg text-foreground">{syncRole}</span>}
              {syncMission && <span className="typo-caption">{syncMission}</span>}
            </motion.div>
          )}
        </AnimatePresence>

        <ThreadLine delay={0.05}>
          <span className="typo-body-lg text-foreground">
            {locked ? "Building this agent from your brief" : "What should this agent do for you?"}
          </span>
          {!locked && (
            <span className="typo-caption block mt-0.5">
              Describe the outcome in your words — the rest we'll tune together below.
            </span>
          )}
        </ThreadLine>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.12 }}
          className="rounded-modal border border-card-border bg-card-bg shadow-elevation-2 overflow-hidden"
          style={locked ? { opacity: 0.92 } : undefined}
        >
          <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, var(--color-primary,#60a5fa), transparent)" }} />
          <div className="p-4 flex flex-col gap-3">
            <textarea
              value={intentText}
              onChange={(e) => onIntentChange(e.target.value)}
              onKeyDown={onKey}
              placeholder={t.agents.glyph_intent_placeholder}
              rows={3}
              autoFocus={!locked}
              readOnly={locked}
              disabled={locked}
              className="w-full bg-transparent typo-body-lg text-foreground placeholder:text-foreground/35 placeholder:italic focus:outline-none resize-none disabled:cursor-default"
              data-testid="agent-intent-input"
            />

            <AnimatePresence>
              {(shownStarters.length > 0) && (locked ? !!topStarter : true) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="flex flex-col gap-1.5"
                >
                  <span className="typo-label text-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-primary" />
                    {locked ? "Building on recipe" : "Faster path — tap a recipe to start from it"}
                  </span>
                  <div className="flex flex-col gap-1.5">
                    {(locked ? shownStarters.slice(0, 1) : shownStarters.slice(0, 3)).map((m) => (
                      <StarterRow key={m.recipe_id} match={m} onOpen={locked ? undefined : () => setOpenRecipe(m)} />
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {locked && composing ? (
              <div className="flex items-center gap-2 pt-1" data-testid="dialoguecinema-loadingbar">
                <Loader2 className="w-3.5 h-3.5 text-primary animate-spin shrink-0" />
                <span className="relative h-1.5 flex-1 rounded-full bg-foreground/10 overflow-hidden">
                  <motion.span
                    className="absolute inset-y-0 w-1/3 rounded-full bg-primary/70 blur-[1px]"
                    animate={{ left: ["-33%", "100%"] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
                  />
                </span>
                <span className="typo-caption shrink-0">composing…</span>
              </div>
            ) : locked ? (
              <div className="flex items-center gap-2 pt-1 typo-caption" data-testid="dialoguecinema-loadingbar">
                <Check className="w-3.5 h-3.5 shrink-0" style={{ color: ACCENT }} />
                <span>Brief locked — continue below.</span>
              </div>
            ) : (
              <div className="flex items-center justify-between pt-1">
                <span className="typo-caption">
                  <kbd className="px-1 rounded bg-foreground/10">Enter</kbd> to build ·{" "}
                  <kbd className="px-1 rounded bg-foreground/10">Shift+Enter</kbd> newline
                </span>
                <button
                  type="button"
                  onClick={onLaunch}
                  disabled={launchDisabled}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-interactive border border-primary/50 bg-primary/20 text-foreground hover:bg-primary/30 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer typo-body font-medium transition-colors"
                  style={{ boxShadow: "0 0 18px rgba(96,165,250,0.25)" }}
                  data-testid="agent-launch-btn"
                >
                  <Send className="w-3.5 h-3.5" />
                  {t.agents.glyph_launch}
                </button>
              </div>
            )}
          </div>
        </motion.div>

        {/* Dimension badges — the optional levers under the intent. They no
            longer echo their applied VALUE (that lives once, in the Blueprint
            card); a badge just names its dimension and lights up when set.
            Persona core sits among them — optional, like every other dimension. */}
        <div className="flex flex-wrap items-center gap-2">
          {dimensionItems.map((item, i) => (
            <DimensionBadge key={item.dim} item={item} index={i} disabled={locked} />
          ))}
          {core && onOpenCore && (
            <PersonaCoreBadge core={core} onOpen={onOpenCore} locked={locked} index={dimensionItems.length} />
          )}
        </div>
      </div>

      {/* ── Forming-persona rail — interactive in compose, view-only while
          building (the sigil + blueprint stay on screen, just not clickable). ── */}
      <div className={`hidden lg:flex w-[300px] shrink-0 flex-col items-center gap-3 ${locked ? "opacity-95" : ""}`}>
        <div className={`relative ${locked ? "pointer-events-none" : ""}`} style={{ width: 260, height: 260 }}>
          <InteractiveSigil
            row={cfg.formingRow}
            rowIndex={0}
            hoveredDim={null}
            activeDim={null}
            onHover={() => {}}
            onClick={locked ? () => {} : (dim) => {
              const it = cfg.items.find((x) => x.dim === dim);
              if (it && it.kind !== "input") it.onClick();
            }}
            size={260}
          />
        </div>
        <div className="w-full rounded-card border border-border/20 bg-foreground/[0.03] p-3">
          <span className="typo-label text-foreground">
            {showCaps ? `Capabilities · ${caps.length}` : locked ? "Blueprint · view" : "Blueprint"}
          </span>
          <div className="mt-2 flex flex-col gap-2 min-h-[2rem]">
            {showCaps ? (
              <AnimatePresence initial={false}>
                {caps.map((cap, i) => (
                  <motion.div
                    key={cap.id ?? cap.title ?? i}
                    layout
                    initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: EASE, delay: Math.min(i * 0.04, 0.2) }}
                    className="flex flex-col gap-1"
                  >
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 shrink-0" style={{ color: ACCENT }} />
                      <span className="typo-caption text-foreground">{cap.title}</span>
                    </div>
                    {(cap.connectors?.length ?? 0) > 0 && (
                      <div className="flex flex-wrap gap-1 pl-5.5">
                        {cap.connectors!.map((name) => {
                          const meta = getConnectorMeta(name);
                          return (
                            <span key={name} className="w-4 h-4 rounded-full flex items-center justify-center" title={meta.label}><ConnectorIcon meta={meta} /></span>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                ))}
              </AnimatePresence>
            ) : (
              <AnimatePresence mode="popLayout">
                {activeItems.length === 0 ? (
                  <motion.span key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="typo-caption italic">
                    Nothing set yet — smart defaults will fill the gaps.
                  </motion.span>
                ) : (
                  activeItems.map((item) => {
                    const Icon = item.icon;
                    // Connector/channel dimensions render their values as tool
                    // icons; everything else shows the value in normal weight.
                    const iconable = item.dim === "connector" || item.dim === "message";
                    return (
                      <motion.div
                        key={item.dim}
                        layout
                        initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
                        transition={{ duration: 0.2, ease: EASE }}
                        className="flex items-start gap-2"
                      >
                        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" style={{ color: item.color }} />
                        <div className="flex flex-col gap-1 min-w-0">
                          <span className="typo-caption text-foreground">{item.label}</span>
                          {iconable && item.summary.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {item.summary.map((name) => {
                                const meta = getConnectorMeta(name);
                                return (
                                  <span key={name} className="inline-flex items-center gap-1 pl-0.5 pr-1.5 py-0.5 rounded-full border" style={{ borderColor: colorWithAlpha(meta.color, 0.35), background: colorWithAlpha(meta.color, 0.1) }}>
                                    <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center"><ConnectorIcon meta={meta} /></span>
                                    <span className="typo-caption text-foreground">{meta.label}</span>
                                  </span>
                                );
                              })}
                            </div>
                          ) : (
                            <span className="typo-caption text-foreground">{item.summary.join(", ") || "on"}</span>
                          )}
                        </div>
                      </motion.div>
                    );
                  })
                )}
              </AnimatePresence>
            )}
          </div>
        </div>
        </div>
    </motion.div>
    {openRecipe && (
      <RecipeAlternativeModal
        recipeId={openRecipe.recipe_id}
        recipeName={openRecipe.recipe_name}
        matchScore={openRecipe.score}
        onClose={() => setOpenRecipe(null)}
        onSelect={selectRecipeAlternative}
      />
    )}
    </>
  );
}

/** A left-accented "assistant said" line — the conversation's connective tissue. */
/** A single dimension lever in the badge row: icon + label, tinted when set.
 *  It deliberately does NOT show the applied value — that lives once in the
 *  Blueprint card. Clicking opens its picker / toggles it (unless locked). */
function DimensionBadge({ item, index, disabled = false }: { item: ComposeConfigItem; index: number; disabled?: boolean }) {
  const Icon = item.icon;
  return (
    <motion.button
      type="button"
      onClick={disabled ? undefined : item.onClick}
      disabled={disabled}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: EASE, delay: 0.18 + index * 0.03 }}
      className={`inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-interactive border transition-colors ${disabled ? "cursor-default" : "cursor-pointer hover:border-foreground/30"}`}
      style={{
        borderColor: item.active ? colorWithAlpha(item.color, 0.5) : "rgba(255,255,255,0.12)",
        background: item.active ? colorWithAlpha(item.color, 0.14) : "rgba(255,255,255,0.03)",
      }}
      data-testid={`dialogue-chip-${item.dim}`}
      aria-pressed={item.active}
    >
      <span className="w-5 h-5 rounded-input flex items-center justify-center shrink-0" style={{ background: item.active ? colorWithAlpha(item.color, 0.22) : "rgba(255,255,255,0.05)" }}>
        <Icon className="w-3.5 h-3.5" style={{ color: item.active ? item.color : undefined }} />
      </span>
      <span className="typo-caption text-foreground">{item.label}</span>
    </motion.button>
  );
}

export function ThreadLine({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
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

function StarterRow({ match, onOpen }: { match: RecipeMatch; onOpen?: () => void }) {
  const pct = Math.round(match.score * 100);
  const inner = (
    <>
      <span className="typo-body text-foreground flex-1 truncate text-left">{match.recipe_name}</span>
      <span className="w-16 h-1.5 rounded-full bg-foreground/10 overflow-hidden shrink-0">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: match.above_threshold ? "var(--color-primary,#60a5fa)" : "rgba(255,255,255,0.3)" }} />
      </span>
      <span className="typo-data text-foreground tabular-nums w-9 text-right shrink-0">{pct}%</span>
      {onOpen && <ChevronRight className="w-3.5 h-3.5 text-foreground shrink-0" />}
    </>
  );
  if (!onOpen) {
    return <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-card border border-border/20 bg-foreground/[0.02]">{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center gap-2 px-2.5 py-1.5 rounded-card border border-border/20 bg-foreground/[0.02] hover:bg-foreground/[0.05] hover:border-primary/40 transition-colors cursor-pointer"
      data-testid={`recipe-starter-${match.recipe_id}`}
    >
      {inner}
    </button>
  );
}
