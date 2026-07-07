/** useRecipeStarters — debounced recipe decision-support for the compose flow.
 *
 *  The core UX problem the Glyph redesign is solving: with hundreds of recipes
 *  and templates, the user can't tell which to start from. This hook turns the
 *  free-text intent into a ranked shortlist by calling `match_recipes_to_intent`
 *  (the same semantic matcher behind the composer suggestion chip) 300ms after
 *  typing settles. Unlike the single-chip suggestion, it returns the top-K so a
 *  surface can VISUALIZE the option field (Constellation) or list starters
 *  (Dialogue). Returns [] until the intent clears MIN_LEN.
 */
import { useEffect, useRef, useState } from "react";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { silentCatch } from "@/lib/silentCatch";
import type { RecipeMatch } from "@/lib/bindings/RecipeMatch";

const DEBOUNCE_MS = 300;
const MIN_LEN = 12;

export function useRecipeStarters(intent: string, topK = 6): RecipeMatch[] {
  const [matches, setMatches] = useState<RecipeMatch[]>([]);
  const reqId = useRef(0);

  useEffect(() => {
    const trimmed = intent.trim();
    if (trimmed.length < MIN_LEN) {
      setMatches([]);
      return;
    }
    const mine = ++reqId.current;
    const handle = setTimeout(() => {
      invokeWithTimeout<RecipeMatch[]>("match_recipes_to_intent", { intent: trimmed, topK })
        .then((results) => {
          // Ignore stale responses if the intent changed while in flight.
          if (mine !== reqId.current) return;
          setMatches(results);
        })
        .catch(silentCatch("useRecipeStarters.match"));
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [intent, topK]);

  return matches;
}
