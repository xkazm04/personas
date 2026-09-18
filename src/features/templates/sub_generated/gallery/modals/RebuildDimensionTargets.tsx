/**
 * Per-dimension regeneration targets for the Rebuild modal.
 *
 * Rebuild used to be a free-text direction box: there was no way to say
 * "regenerate Tools only", so a template with one weak dimension had its whole
 * design reshuffled. These rows score the same 9 dimensions
 * `reviews.rs::score_design_result()` does (via `evaluateDimensions`, already
 * the radial's model) and let the reviewer flag the failing ones as targets.
 *
 * Extracted from RebuildModal so that file stays a modal shell rather than
 * growing a second concern.
 */
import { CheckCircle2, XCircle } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import type { Translations } from '@/i18n/generated/types';
import type { AgentIR } from '@/lib/types/designTypes';
import { DIMENSIONS, evaluateDimensions, type DimensionKey } from '../../shared/DimensionRadial';
import { DesignCheckbox } from '../../design-preview/DesignCheckbox';

const DIM_LABEL: Record<DimensionKey, (t: Translations) => string> = {
  prompt: (t) => t.templates.rebuild_modal.dim_prompt,
  tools: (t) => t.templates.rebuild_modal.dim_tools,
  triggers: (t) => t.templates.rebuild_modal.dim_triggers,
  connectors: (t) => t.templates.rebuild_modal.dim_connectors,
  flows: (t) => t.templates.rebuild_modal.dim_flows,
  events: (t) => t.templates.rebuild_modal.dim_events,
  notifications: (t) => t.templates.rebuild_modal.dim_notifications,
  summary: (t) => t.templates.rebuild_modal.dim_summary,
  service_flow: (t) => t.templates.rebuild_modal.dim_service_flow,
};

export function RebuildDimensionTargets({
  designResult,
  selected,
  onToggle,
}: {
  designResult: AgentIR | null;
  selected: ReadonlySet<DimensionKey>;
  onToggle: (dim: DimensionKey) => void;
}) {
  const { t } = useTranslation();
  const scores = evaluateDimensions(designResult);

  return (
    <div data-testid="rebuild-dimension-targets">
      <div className="typo-heading text-foreground mb-1.5">
        {t.templates.rebuild_modal.regen_title}
      </div>
      <div className="rounded-modal border border-primary/10 bg-secondary/20 divide-y divide-primary/5">
        {DIMENSIONS.map((dim) => {
          const passed = scores[dim];
          const label = DIM_LABEL[dim](t);
          return (
            <div key={dim} className="flex items-center gap-2.5 px-3 py-1.5" data-testid={`rebuild-dim-${dim}`}>
              <DesignCheckbox
                checked={selected.has(dim)}
                onChange={() => onToggle(dim)}
                color="purple"
              />
              <span className="flex-1 typo-body text-foreground truncate">{label}</span>
              {passed ? (
                <CheckCircle2
                  className="w-3.5 h-3.5 text-emerald-400 shrink-0"
                  aria-label={t.templates.rebuild_modal.regen_passed}
                  data-testid={`rebuild-dim-${dim}-passed`}
                />
              ) : (
                <XCircle
                  className="w-3.5 h-3.5 text-amber-400 shrink-0"
                  aria-label={t.templates.rebuild_modal.regen_failed}
                  data-testid={`rebuild-dim-${dim}-failed`}
                />
              )}
            </div>
          );
        })}
      </div>
      <p className="typo-body text-foreground mt-1">{t.templates.rebuild_modal.regen_hint}</p>
    </div>
  );
}

/**
 * Fold the checked dimensions into the CLI direction.
 *
 * The rebuild command takes one free-text `userInstruction`, so the targets
 * ride in it rather than needing a new IPC shape. Naming them explicitly is
 * what keeps a rebuild local to the weak dimensions instead of reshuffling the
 * whole entry. The text is a PROMPT, not UI copy, so it stays English - the
 * same reason `handleApplyAdjustment` composes its "Additional requirements"
 * line in English.
 */
export function composeRebuildDirection(
  userDirection: string,
  targets: readonly DimensionKey[],
): string {
  const direction = userDirection.trim();
  if (targets.length === 0) return direction;
  const named = targets.join(', ');
  const scoped =
    `Regenerate ONLY these design dimensions: ${named}. ` +
    `Leave every other dimension of the existing design exactly as it is.`;
  return direction ? `${scoped}\n\n${direction}` : scoped;
}
