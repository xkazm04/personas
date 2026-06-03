import { useState, useEffect, useRef, useCallback } from "react";
import { companionMatchTemplates, type CompanionTemplateMatch } from "@/api/companion";

const MIN_CHARS = 8;
const DEBOUNCE_MS = 300;

/**
 * Live template matching for the unified creator (glyph-convergence Phase 2).
 *
 * As the user types their intent, debounce 300ms and rank the template corpus
 * via `companion_match_templates` (the same fast matcher the home stepper and
 * Athena's TemplateSuggestionsWidget use). Mirrors the ComposerRecipeSuggestion
 * guards: a min-char gate, out-of-order responses dropped via a request-id
 * ref, and best-effort errors (an empty list, never a surfaced error mid-type).
 * The command already ranks + limits, so there's no client-side score
 * threshold here — we trust its ordering.
 *
 * `loading` is true only while a real request (intent ≥ MIN_CHARS) is in
 * flight, so the caller can keep the curated starters visible instead of
 * flashing an empty state between keystrokes.
 */
export function useTemplateIntentMatch(intent: string, limit = 5): {
  matches: CompanionTemplateMatch[];
  loading: boolean;
} {
  const [matches, setMatches] = useState<CompanionTemplateMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const reqIdRef = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    async (text: string) => {
      const requestId = ++reqIdRef.current;
      if (text.trim().length < MIN_CHARS) {
        setMatches([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const result = await companionMatchTemplates(text.trim(), limit);
        if (requestId !== reqIdRef.current) return; // a newer keystroke won
        setMatches(result ?? []);
      } catch {
        if (requestId !== reqIdRef.current) return;
        setMatches([]);
      } finally {
        if (requestId === reqIdRef.current) setLoading(false);
      }
    },
    [limit],
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

  return { matches, loading };
}
