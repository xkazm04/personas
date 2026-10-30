import { useState, useEffect, useRef, useCallback } from "react";
import { createLatestWins } from "@/stores/util/latestWins";
import { companionMatchTemplates, type CompanionTemplateMatch } from "@/api/companion";
import { silentCatch } from "@/lib/silentCatch";

const MIN_CHARS = 8;
const DEBOUNCE_MS = 300;

/**
 * Live template matching for the unified creator (glyph-convergence Phase 2).
 *
 * As the user types their intent, debounce 300ms and rank the template corpus
 * via `companion_match_templates` (the same fast matcher the home stepper and
 * Athena's TemplateSuggestionsWidget use). Mirrors the guards of the retired
 * ComposerRecipeSuggestion chip: a min-char gate, out-of-order responses dropped via a request-id
 * ref, and best-effort errors (an empty list, never a surfaced error mid-type).
 * The command already ranks + limits, so there's no client-side score
 * threshold here — we trust its ordering.
 *
 * `loading` is true from the keystroke that makes the intent long enough
 * (intent ≥ MIN_CHARS) until its request settles - the 300ms debounce
 * included - so the caller can keep the curated starters visible instead of
 * flashing an empty state between keystrokes.
 */
export function useTemplateIntentMatch(intent: string, limit = 5): {
  matches: CompanionTemplateMatch[];
  loading: boolean;
} {
  const [matches, setMatches] = useState<CompanionTemplateMatch[]>([]);
  const [loading, setLoading] = useState(false);
  // The intent whose match has SETTLED (answered, failed or cleared as too
  // short). A long-enough intent that differs from it is pending: the debounce
  // has not fired yet, but a request is coming, so the caller must not paint
  // its no-match state in the meantime.
  const [settledIntent, setSettledIntent] = useState<string | null>(null);
  // One latest-wins slot per hook instance: a newer keystroke's request makes
  // every older one inert (the repo's shared guard, not a hand-rolled counter).
  const [latest] = useState(createLatestWins);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (text: string) => {
      const requestId = latest.next();
      if (text.trim().length < MIN_CHARS) {
        setMatches([]);
        setLoading(false);
        setSettledIntent(text);
        return;
      }
      setLoading(true);
      try {
        const result = await companionMatchTemplates(text.trim(), limit);
        if (!latest.isCurrent(requestId)) return; // a newer keystroke won
        setMatches(result ?? []);
      } catch (err) {
        // Best-effort by contract (no surfaced error mid-type), but the swallow
        // still gets a Sentry breadcrumb so matcher outages are measurable.
        silentCatch('useTemplateIntentMatch:match')(err);
        if (!latest.isCurrent(requestId)) return;
        setMatches([]);
      } finally {
        if (latest.isCurrent(requestId)) {
          setLoading(false);
          setSettledIntent(text);
        }
      }
    },
    [limit, latest],
  );

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void run(intent);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [intent, run]);

  const pending = intent.trim().length >= MIN_CHARS && intent !== settledIntent;
  return { matches, loading: loading || pending };
}
