/**
 * Stage D Phase 5 — eligibility hook for the composer's mode-2 ("Run now")
 * affordance.
 *
 * Lazy by design: only fetches stats when `enabled` flips true (the chip
 * just became visible to the user). Once fetched, the result sticks for
 * the lifetime of the component — re-fetching on every chip impression
 * would burn IPC for no UX win, since accept-rate moves slowly.
 *
 * The gate (`mode_2_eligible`) is computed entirely server-side in
 * `commands::recipes::recipe_suggestion_log::get_recipe_suggestion_stats`
 * — the frontend never re-implements the threshold logic, so tuning the
 * accept-rate / sample-size thresholds in Rust automatically propagates.
 */
import { useEffect, useState } from "react";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { silentCatch } from "@/lib/silentCatch";
import type { RecipeSuggestionStats } from "@/lib/bindings/RecipeSuggestionStats";

type Eligibility = "unknown" | "eligible" | "ineligible";

export function useRecipeSuggestionEligibility(enabled: boolean): Eligibility {
  const [eligibility, setEligibility] = useState<Eligibility>("unknown");

  useEffect(() => {
    if (!enabled || eligibility !== "unknown") return;
    let cancelled = false;
    invokeWithTimeout<RecipeSuggestionStats>("get_recipe_suggestion_stats", {
      window: null,
    })
      .then((stats) => {
        if (cancelled) return;
        setEligibility(stats.mode_2_eligible ? "eligible" : "ineligible");
      })
      .catch(silentCatch("useRecipeSuggestionEligibility.fetch"));
    return () => {
      cancelled = true;
    };
  }, [enabled, eligibility]);

  return eligibility;
}
