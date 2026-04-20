/**
 * Use-case picker — first step of the adoption flow when a template declares
 * multiple use cases (`use_cases` / `use_case_flows`). Lets the user turn
 * capabilities on/off before the questionnaire runs.
 *
 * Disabled capabilities are excluded from:
 *   - the downstream questionnaire (questions tied to the capability via
 *     `use_case_id` / `use_case_ids` are filtered out before render)
 *   - the persona matrix in the next step (use-cases cell + per-use-case
 *     triggers)
 *
 * Shown only when the template has ≥2 use cases — single-use-case templates
 * skip straight to the questionnaire since there's nothing to pick.
 */
import { Sparkles, Check, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTranslation } from '@/i18n/useTranslation';

export interface UseCaseOption {
  id: string;
  name: string;
  description?: string;
  capability_summary?: string;
}

interface Props {
  templateName?: string;
  templateGoal?: string | null;
  useCases: UseCaseOption[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onContinue: () => void;
}

export function UseCasePickerStep({
  templateName,
  templateGoal,
  useCases,
  selectedIds,
  onToggle,
  onContinue,
}: Props) {
  const { t, tx } = useTranslation();
  const selectedCount = useCases.filter((u) => selectedIds.has(u.id)).length;
  const canContinue = selectedCount > 0;

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex-shrink-0 border-b border-white/[0.06]">
        <div className="max-w-4xl mx-auto px-6 pt-6 pb-5 text-center">
          <div className="flex items-center justify-center gap-2.5 mb-2">
            <Sparkles className="w-5 h-5 text-primary/80" />
            <h2 className="text-lg font-semibold text-foreground">
              {t.templates.adopt_modal.use_cases_title}
            </h2>
          </div>
          <p className="typo-body text-foreground/70 max-w-2xl mx-auto">
            {templateName ? `${templateName} · ` : ''}
            {t.templates.adopt_modal.use_cases_subtitle}
          </p>
          {templateGoal ? (
            <p className="typo-body italic text-foreground/60 max-w-2xl mx-auto mt-1">
              {templateGoal}
            </p>
          ) : null}
          <div className="mt-3 text-sm text-foreground/70 tabular-nums">
            {tx(t.templates.adopt_modal.use_cases_enabled_count, {
              count: selectedCount,
              total: useCases.length,
            })}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-6 py-6 space-y-3">
          {useCases.map((uc) => {
            const enabled = selectedIds.has(uc.id);
            return (
              <motion.button
                key={uc.id}
                type="button"
                onClick={() => onToggle(uc.id)}
                layout
                whileTap={{ scale: 0.995 }}
                className={`group relative w-full text-left rounded-2xl border transition-all p-4 ${
                  enabled
                    ? 'bg-primary/[0.07] border-primary/25 hover:border-primary/40'
                    : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.1]'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Toggle indicator — behaves visually like a checkbox */}
                  <div
                    className={`flex-shrink-0 mt-0.5 w-5 h-5 rounded-md border flex items-center justify-center transition-all ${
                      enabled
                        ? 'bg-primary border-primary'
                        : 'bg-transparent border-white/[0.2] group-hover:border-white/[0.3]'
                    }`}
                  >
                    {enabled && <Check className="w-3.5 h-3.5 text-white" strokeWidth={3} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`text-md font-semibold leading-snug ${
                          enabled ? 'text-foreground' : 'text-foreground/80'
                        }`}
                      >
                        {uc.name}
                      </span>
                      <span
                        className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${
                          enabled
                            ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400'
                            : 'bg-white/[0.04] border-white/[0.1] text-foreground/50'
                        }`}
                      >
                        {enabled
                          ? t.templates.adopt_modal.use_case_enabled_badge
                          : t.templates.adopt_modal.use_case_disabled_badge}
                      </span>
                    </div>
                    {uc.capability_summary && (
                      <p
                        className={`mt-1 typo-body leading-relaxed ${
                          enabled ? 'text-foreground/80' : 'text-foreground/50'
                        }`}
                      >
                        {uc.capability_summary}
                      </p>
                    )}
                    {uc.description &&
                      uc.description !== uc.capability_summary && (
                        <p
                          className={`mt-1 text-sm leading-relaxed ${
                            enabled ? 'text-foreground/65' : 'text-foreground/40'
                          }`}
                        >
                          {uc.description}
                        </p>
                      )}
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>

      <div className="flex-shrink-0 border-t border-white/[0.06]">
        <div className="max-w-4xl mx-auto flex items-center justify-between px-6 py-4">
          <span className="typo-caption text-foreground/60">
            {!canContinue && t.templates.adopt_modal.use_cases_none_selected}
          </span>
          <button
            type="button"
            onClick={onContinue}
            disabled={!canContinue}
            className="flex items-center gap-2 px-6 py-2 typo-body font-medium rounded-modal bg-btn-primary text-white hover:bg-btn-primary/90 disabled:opacity-40 disabled:cursor-not-allowed shadow-elevation-3 shadow-primary/20 transition-all"
          >
            {t.templates.adopt_modal.use_cases_continue}
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
