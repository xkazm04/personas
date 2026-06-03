/**
 * BuildTemplateSuggestion — glyph-convergence redesign (2026-06-01).
 *
 * Mid-build template proposal. The user starts a persona from scratch and the
 * glyph build produces its first set of clarifying questions; at that moment we
 * fire the fast lexical matcher (`companion_match_templates`, sub-second, no LLM)
 * against the user's intent. If a published template looks like a strong match,
 * we surface a single dismissible card ABOVE the questionnaire:
 *
 *   "{Template} looks like a match — use it to skip these questions?"
 *
 * The user stays in control. Accepting routes to template adoption (faster,
 * pre-configured, tested); dismissing keeps them in the from-scratch flow. This
 * replaces the reverted front-door launcher (R1) — the suggestion now lives mid
 * build instead of gating the entry. See docs/concepts/glyph-convergence.md.
 *
 * Mounted at the UnifiedBuildEntry container level so it works identically for
 * both the glyph-full and composer-prototype layouts without prop-threading
 * through either.
 */
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Loader2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import type { CompanionTemplateMatch } from '@/api/companion';
import { useTemplateIntentMatch } from '@/features/agents/components/create/useTemplateIntentMatch';
import { strongMatches } from './buildTemplateMatchConfidence';

interface BuildTemplateSuggestionProps {
  /** The build intent to match against the published-template corpus. */
  intent: string;
  /**
   * Whether matching should run. The parent gates this to "first questions have
   * landed and the user hasn't dismissed yet" so the matcher doesn't fire during
   * compose or after the user has chosen to keep building.
   */
  active: boolean;
  /** User accepted — route to template adoption with this match. May be async. */
  onAccept: (match: CompanionTemplateMatch) => void | Promise<void>;
  /** User dismissed — stay in the from-scratch questionnaire. */
  onDismiss: () => void;
}

export function BuildTemplateSuggestion({
  intent,
  active,
  onAccept,
  onDismiss,
}: BuildTemplateSuggestionProps) {
  const { t, tx } = useTranslation();
  // Pass an empty string when inactive so the hook clears its matches (the
  // MIN_CHARS gate inside the hook treats "" as "no query") — no request fires
  // during compose or after dismissal.
  const { matches } = useTemplateIntentMatch(active ? intent : '');
  // `acceptingId` doubles as the in-flight flag (non-null) and the spinner
  // target, so the right primary/secondary control animates while its review
  // is fetched and the build is cancelled.
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Confidence gate: drop weak single-keyword coincidences before surfacing.
  // The matcher returns relevance-ordered rows; we keep the order and show the
  // strongest as primary plus up to two more as compact "or start from" chips.
  const strong = strongMatches(intent, matches);
  const top = strong[0];
  const secondary = strong.slice(1, 3);
  const show = active && !!top;

  const accept = async (match: CompanionTemplateMatch) => {
    if (acceptingId) return;
    setAcceptingId(match.id);
    try {
      await onAccept(match);
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={`build-template-match-${top.id}`}
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="flex-shrink-0 mb-3"
          data-testid="build-template-suggestion"
        >
          <div className="flex items-start gap-3 rounded-card border border-primary/25 bg-primary/[0.07] px-4 py-3">
            <div className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="typo-caption uppercase tracking-wide text-primary/80">
                {t.agents.build_template_match_label}
              </p>
              <p className="typo-body font-semibold text-foreground">
                {tx(t.agents.build_template_match_title, { name: top.name })}
              </p>
              <p className="typo-caption mt-0.5 text-foreground/85">
                {t.agents.build_template_match_body}
              </p>
              {top.snippet ? (
                <p className="typo-caption mt-1.5 line-clamp-2 text-foreground/85 italic">
                  {top.snippet}
                </p>
              ) : null}
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <AsyncButton
                  variant="primary"
                  size="sm"
                  isLoading={acceptingId === top.id}
                  onClick={() => { void accept(top); }}
                  data-testid="build-template-suggestion-adopt"
                >
                  {t.agents.build_template_match_adopt}
                </AsyncButton>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDismiss}
                  disabled={acceptingId !== null}
                  data-testid="build-template-suggestion-dismiss"
                >
                  {t.agents.build_template_match_dismiss}
                </Button>
              </div>
              {secondary.length > 0 && (
                <div
                  className="mt-2 flex flex-wrap items-center gap-1.5"
                  data-testid="build-template-suggestion-more"
                >
                  <span className="typo-caption text-foreground/85">
                    {t.agents.build_template_match_more}
                  </span>
                  {secondary.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => { void accept(m); }}
                      disabled={acceptingId !== null}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/[0.06] px-2.5 py-1 typo-caption text-foreground/85 transition hover:bg-primary/15 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                      data-testid={`build-template-suggestion-alt-${m.id}`}
                    >
                      {acceptingId === m.id && (
                        <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                      )}
                      {m.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
