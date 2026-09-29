/**
 * BuildTemplateSuggestion — the "Faster path" row (glyph-convergence R2/R3,
 * compacted into the sheet 2026-09-28).
 *
 * Mid-build template proposal. The user starts a persona from scratch and the
 * glyph build produces its first set of clarifying questions; at that moment we
 * fire the fast lexical matcher (`companion_match_templates`, sub-second, no LLM)
 * against the user's intent. If a published template is a strong match, ONE
 * quiet row surfaces inside the sheet's centre action panel (questions act):
 *
 *   Faster path · "{Template}" looks like a match   [Use this template] [Keep building]
 *
 * The longer pitch (why, the template's own description, and any other strong
 * matches) sits one layer down in a native disclosure on the title, never on
 * the sheet itself. The user stays in control: accepting routes to template
 * adoption, dismissing keeps them in the from-scratch flow.
 *
 * It used to be a full card mounted above the build layout at the container
 * level; that card pushed the fixed-height Sheet · Cinema down at 1280 x 800
 * (the live check of 2026-09-26), so the container now hands this element to
 * the layout (`GlyphFullLayoutProps.templateSuggestion`) and the action panel
 * renders it. `onShowChange` tells the container whether a match is on screen
 * so the sheet can hold the camera on the panel while the choice is open.
 */
import { useEffect, useRef, useState } from 'react';
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
  /** Whether a match is currently on screen (reported false again on unmount). */
  onShowChange?: (show: boolean) => void;
}

export function BuildTemplateSuggestion({
  intent,
  active,
  onAccept,
  onDismiss,
  onShowChange,
}: BuildTemplateSuggestionProps) {
  const { t, tx } = useTranslation();
  // Pass an empty string when inactive so the hook clears its matches (the
  // MIN_CHARS gate inside the hook treats "" as "no query") — no request fires
  // during compose or after dismissal.
  const { matches } = useTemplateIntentMatch(active ? intent : '');
  // `acceptingId` doubles as the in-flight flag (non-null) and the spinner
  // target, so the right control animates while its review is fetched and the
  // build is cancelled.
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  // Confidence gate: drop weak single-keyword coincidences before surfacing.
  // The matcher returns relevance-ordered rows; we keep the order and show the
  // strongest as primary plus up to two more one layer down.
  const strong = strongMatches(intent, matches);
  const top = strong[0];
  const secondary = strong.slice(1, 3);
  const show = active && !!top;

  const showChange = useRef(onShowChange);
  showChange.current = onShowChange;
  useEffect(() => { showChange.current?.(show); }, [show]);
  useEffect(() => () => { showChange.current?.(false); }, []);

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
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          key={`build-template-match-${top.id}`}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
          className="min-w-0 overflow-hidden"
          data-testid="build-template-suggestion"
        >
          <div className="flex items-start gap-2 rounded-input border border-primary/20 bg-primary/[0.06] px-2.5 py-1.5 min-w-0">
            <Sparkles className="mt-1 h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden />
            <details className="group min-w-0 flex-1">
              <summary className="cursor-pointer list-none typo-caption text-foreground [&::-webkit-details-marker]:hidden">
                <span className="text-primary">{t.agents.build_template_match_label}</span>
                <span aria-hidden> · </span>
                <span className="underline decoration-dotted decoration-foreground/40 underline-offset-2 group-open:no-underline">
                  {tx(t.agents.build_template_match_title, { name: top.name })}
                </span>
              </summary>
              <div className="mt-1 flex flex-col gap-1">
                <p className="typo-caption text-foreground">{t.agents.build_template_match_body}</p>
                {top.snippet ? (
                  <p className="typo-caption line-clamp-3 italic text-foreground">{top.snippet}</p>
                ) : null}
                {secondary.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5" data-testid="build-template-suggestion-more">
                    <span className="typo-caption text-foreground">{t.agents.build_template_match_more}</span>
                    {secondary.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => { void accept(m); }}
                        disabled={acceptingId !== null}
                        aria-busy={acceptingId === m.id || undefined}
                        className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/[0.06] px-2 py-0.5 typo-caption text-foreground transition hover:bg-primary/15 disabled:opacity-40 disabled:cursor-not-allowed"
                        data-testid={`build-template-suggestion-alt-${m.id}`}
                      >
                        {acceptingId === m.id && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </details>
            <div className="flex flex-shrink-0 items-center gap-1">
              <AsyncButton
                variant="secondary"
                size="xs"
                isLoading={acceptingId === top.id}
                disabled={acceptingId !== null && acceptingId !== top.id}
                onClick={() => accept(top)}
                data-testid="build-template-suggestion-adopt"
              >
                {t.agents.build_template_match_adopt}
              </AsyncButton>
              <Button
                variant="ghost"
                size="xs"
                onClick={onDismiss}
                disabled={acceptingId !== null}
                data-testid="build-template-suggestion-dismiss"
              >
                {t.agents.build_template_match_dismiss}
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
