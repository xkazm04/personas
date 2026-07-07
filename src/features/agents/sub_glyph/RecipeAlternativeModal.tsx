/** RecipeAlternativeModal — the "faster path" detail surface for the Dialogue
 *  compose flow.
 *
 *  When the intent matches an existing recipe, the compose surface offers it as
 *  a starter row. Clicking a row opens this modal: it fetches the full recipe
 *  (`get_recipe`), shows what it actually is (description, the connectors it
 *  needs, its model preference, a peek at the prompt), and lets the user SELECT
 *  IT AS AN ALTERNATIVE — pre-filling the intent from the recipe so the build
 *  starts from that proven shape instead of from scratch.
 */
import { useEffect, useState } from "react";
import { Sparkles, Cpu, ArrowRight } from "lucide-react";
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { silentCatch } from "@/lib/silentCatch";
import { BaseModal } from "@/features/shared/components/modals";
import Button from "@/features/shared/components/buttons/Button";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import { getConnectorMeta, ConnectorIcon } from "@/lib/connectors/connectorMeta";
import { colorWithAlpha } from "@/lib/utils/colorWithAlpha";
import type { RecipeDefinition } from "@/lib/bindings/RecipeDefinition";

const ACCENT = "#60A5FA";

/** Best-effort extraction of connector service-type strings from a recipe's
 *  JSON requirement blobs (shape varies: array of strings, or of objects with
 *  service_type/name/connector). Never throws — returns a de-duped name list. */
function parseConnectorNames(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    const arr = Array.isArray(v) ? v : Array.isArray(v?.connectors) ? v.connectors : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of arr) {
      const name = typeof item === "string" ? item : (item?.service_type || item?.connector || item?.name || "");
      const key = String(name).toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(String(name));
    }
    return out;
  } catch {
    return [];
  }
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String).slice(0, 6) : [];
  } catch {
    return raw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 6);
  }
}

interface Props {
  recipeId: string;
  recipeName: string;
  matchScore: number;
  onClose: () => void;
  /** Select-as-alternative: caller pre-fills the intent from the recipe. */
  onSelect: (recipe: RecipeDefinition) => void;
}

export function RecipeAlternativeModal({ recipeId, recipeName, matchScore, onClose, onSelect }: Props) {
  const [recipe, setRecipe] = useState<RecipeDefinition | null>(null);
  const [error, setError] = useState(false);
  const pct = Math.round(matchScore * 100);

  useEffect(() => {
    let live = true;
    invokeWithTimeout<RecipeDefinition>("get_recipe", { id: recipeId })
      .then((r) => { if (live) setRecipe(r); })
      .catch((e) => { silentCatch("RecipeAlternativeModal.get")(e); if (live) setError(true); });
    return () => { live = false; };
  }, [recipeId]);

  const connectors = recipe
    ? Array.from(new Set([...parseConnectorNames(recipe.credential_requirements), ...parseConnectorNames(recipe.tool_requirements)]))
    : [];
  const tags = recipe ? parseTags(recipe.tags) : [];
  const promptPeek = recipe?.prompt_template?.trim().slice(0, 320) ?? "";

  return (
    <BaseModal isOpen onClose={onClose} titleId="recipe-alternative-modal" size="lg">
      <div className="flex flex-col gap-4 p-5" data-testid="recipe-alternative-modal">
        {/* header */}
        <div className="flex items-start gap-3">
          <span className="w-9 h-9 rounded-input flex items-center justify-center shrink-0" style={{ background: colorWithAlpha(ACCENT, 0.16) }}>
            <Sparkles className="w-4 h-4" style={{ color: ACCENT }} />
          </span>
          <div className="flex flex-col gap-0.5 min-w-0">
            <span className="typo-label" style={{ color: ACCENT }}>Faster path · {pct}% match</span>
            <h2 id="recipe-alternative-modal" className="typo-title-lg text-foreground truncate">{recipe?.name ?? recipeName}</h2>
            {recipe?.category && <span className="typo-caption">{recipe.category}</span>}
          </div>
        </div>

        {error ? (
          <div className="py-8 text-center typo-body text-foreground">Couldn't load this recipe.</div>
        ) : !recipe ? (
          <div className="py-10 flex justify-center"><LoadingSpinner label="Loading recipe…" /></div>
        ) : (
          <>
            {recipe.description && <p className="typo-body text-foreground">{recipe.description}</p>}

            {connectors.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="typo-label text-foreground">Connections this recipe uses</span>
                <div className="flex flex-wrap gap-1.5">
                  {connectors.map((name) => {
                    const meta = getConnectorMeta(name);
                    return (
                      <span key={name} className="inline-flex items-center gap-1.5 pl-1 pr-2.5 py-1 rounded-full border" style={{ borderColor: colorWithAlpha(meta.color, 0.4), background: colorWithAlpha(meta.color, 0.12) }}>
                        <span className="w-4 h-4 rounded-full flex items-center justify-center"><ConnectorIcon meta={meta} /></span>
                        <span className="typo-caption text-foreground">{meta.label}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              {recipe.model_preference && (
                <span className="inline-flex items-center gap-1.5 typo-caption">
                  <Cpu className="w-3.5 h-3.5 text-primary" /> {recipe.model_preference}
                </span>
              )}
              {tags.map((tag) => (
                <span key={tag} className="typo-caption px-2 py-0.5 rounded-full bg-foreground/[0.06]">{tag}</span>
              ))}
            </div>

            {promptPeek && (
              <div className="flex flex-col gap-1.5">
                <span className="typo-label text-foreground">What it does</span>
                <pre className="typo-caption text-foreground whitespace-pre-wrap rounded-card border border-border/20 bg-foreground/[0.03] p-3 max-h-32 overflow-y-auto">{promptPeek}{recipe.prompt_template && recipe.prompt_template.length > 320 ? "…" : ""}</pre>
              </div>
            )}

            {/* footer */}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={onClose}>Keep describing</Button>
              <Button
                variant="primary"
                size="sm"
                icon={<ArrowRight className="w-3.5 h-3.5" />}
                onClick={() => { onSelect(recipe); onClose(); }}
                data-testid="recipe-alternative-select"
              >
                Use this recipe as the starting point
              </Button>
            </div>
          </>
        )}
      </div>
    </BaseModal>
  );
}
