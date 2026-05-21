/**
 * Stage E.4 — Glyph use-case blocks (v1).
 *
 * Compact strip rendering each adopted use case from the selected
 * persona's design context as a clickable block. Each block:
 * - shows a category-tinted accent bar, the use-case title, and a
 *   one-line trigger summary
 * - reflects enabled / disabled state visually (active vs muted)
 * - on click, toggles the use case via the existing capability-toggle
 *   pipeline (cascade-aware: confirmation dialog fires when disabling
 *   a capability with linked triggers/subscriptions)
 *
 * The recipe-redesign agreement (project_recipe_redesign memory,
 * 2026-05-02) flagged three placement directions for this surface —
 * petal/sector vs orbiting cards vs strip below the sigil. v1 ships the
 * "strip" variant because it's the least disruptive to the existing
 * GlyphFullLayout; the petal and orbit variants will land as a follow-up
 * after a visual prototype pass.
 *
 * v1 is intentionally NOT mounted into GlyphFullLayout by default — the
 * mount point is a design decision that wants to ride alongside the
 * placement experiment. Components consume this from
 * `@/features/agents/components/glyph` once the right slot is chosen.
 */
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Power, ChevronRight } from "lucide-react";
import { useSelectedUseCases } from "@/stores/selectors/personaSelectors";
import { useAgentStore } from "@/stores/agentStore";
import { useCapabilityToggle } from "@/features/agents/sub_use_cases/libs/useCapabilityToggle";
import type { DesignUseCase } from "@/lib/types/frontendTypes";
import { DebtText } from '@/i18n/DebtText';


interface GlyphUseCaseBlockProps {
  useCase: DesignUseCase;
  pending: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onToggleEnabled: () => void;
}

function GlyphUseCaseBlock({
  useCase,
  pending,
  expanded,
  onToggleExpanded,
  onToggleEnabled,
}: GlyphUseCaseBlockProps) {
  // `enabled` is `boolean | undefined` per the schema; `undefined` is
  // treated as active (legacy default). Mirror that here.
  const isActive = useCase.enabled !== false;
  const triggerSummary =
    useCase.suggested_trigger?.description ??
    (useCase.suggested_trigger?.cron ? `cron: ${useCase.suggested_trigger.cron}` : null);

  return (
    <motion.div
      layout
      className={
        "flex flex-col rounded-card border bg-card-bg overflow-hidden transition-colors " +
        (isActive
          ? "border-card-border"
          : "border-card-border/40 opacity-60 hover:opacity-80")
      }
      style={{ minWidth: 220, maxWidth: 360 }}
    >
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/20 transition-colors"
      >
        <span
          aria-hidden
          className={
            "shrink-0 w-1 self-stretch rounded-full " +
            (isActive ? "bg-primary" : "bg-foreground/30")
          }
        />
        <span className="flex-1 min-w-0">
          <span className="block typo-body font-medium text-foreground truncate">
            {useCase.title}
          </span>
          {triggerSummary && (
            <span className="block typo-caption text-foreground truncate">
              {triggerSummary}
            </span>
          )}
        </span>
        <ChevronRight
          className={
            "h-3.5 w-3.5 text-foreground transition-transform " +
            (expanded ? "rotate-90" : "")
          }
          aria-hidden
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden border-t border-card-border/60"
          >
            <div className="px-3 py-2 typo-caption text-foreground/85 space-y-2">
              {useCase.description && (
                <p className="leading-relaxed line-clamp-3">{useCase.description}</p>
              )}
              {useCase.tool_hints && useCase.tool_hints.length > 0 && (
                <p className="text-foreground">
                  <span className="font-medium text-foreground"><DebtText k="auto_tools_a2074920" /> </span>
                  {useCase.tool_hints.slice(0, 4).join(", ")}
                  {useCase.tool_hints.length > 4 && ` +${useCase.tool_hints.length - 4}`}
                </p>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleEnabled();
                }}
                disabled={pending}
                className={
                  "inline-flex items-center gap-1.5 rounded-input border px-2 py-1 typo-caption font-medium transition-colors " +
                  (isActive
                    ? "border-card-border bg-card-bg hover:bg-secondary/40"
                    : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20") +
                  (pending ? " opacity-60 cursor-wait" : "")
                }
              >
                <Power className="h-3 w-3" aria-hidden />
                {isActive ? "Pause" : "Activate"}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * Strip of adopted-use-case blocks for the currently selected persona.
 * Renders nothing when no persona is selected or the persona has no
 * use cases — a graceful degradation that lets the parent slot us in
 * without conditional logic of its own.
 */
export function GlyphUseCaseBlocks() {
  const useCases = useSelectedUseCases();
  const personaId = useAgentStore((s) => s.selectedPersona?.id ?? null);
  const { requestToggle, pendingUseCaseId } = useCapabilityToggle();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!personaId || useCases.length === 0) return null;

  return (
    <div
      data-testid="glyph-use-case-blocks"
      className="flex flex-wrap gap-2 px-3 py-2"
    >
      {useCases.map((uc) => (
        <GlyphUseCaseBlock
          key={uc.id}
          useCase={uc}
          pending={pendingUseCaseId === uc.id}
          expanded={expandedId === uc.id}
          onToggleExpanded={() =>
            setExpandedId((prev) => (prev === uc.id ? null : uc.id))
          }
          onToggleEnabled={() =>
            requestToggle(personaId, uc.id, uc.title, uc.enabled === false)
          }
        />
      ))}
    </div>
  );
}
