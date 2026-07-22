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
import { parseRecipeNameList } from "./commandPanel/commandPanelHelpers";

const ACCENT = "#60A5FA";

/** Case-insensitive de-dupe, preserving first-seen casing/order. */
function dedupeNames(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const key = name.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
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

/** The recipe's tunable "dimensions" — the fields declared in input_schema.
 *  Shape varies (array of {name,label}, or an object keyed by field name), so
 *  extract a de-duped label list defensively. */
function parseDimensions(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    const fields = Array.isArray(v) ? v : Array.isArray(v?.fields) ? v.fields : v && typeof v === "object" ? Object.entries(v).map(([k, def]) => ({ name: k, ...(def as object) })) : [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const f of fields) {
      const label = String(f?.label || f?.title || f?.name || f || "").replace(/_/g, " ").trim();
      const key = label.toLowerCase();
      if (!label || seen.has(key)) continue;
      seen.add(key);
      out.push(label);
    }
    return out.slice(0, 8);
  } catch {
    return [];
  }
}

/** Emoji test — recipe.icon is sometimes an emoji, sometimes an icon-name slug. */
function isEmoji(s: string | null): boolean {
  return !!s && /\p{Extended_Pictographic}/u.test(s);
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
    ? dedupeNames([
        ...parseRecipeNameList(recipe.credential_requirements),
        ...parseRecipeNameList(recipe.tool_requirements),
      ])
    : [];
  const tags = recipe ? parseTags(recipe.tags) : [];
  const dimensions = recipe ? parseDimensions(recipe.input_schema) : [];
  const sigilColor = recipe?.color || ACCENT;

  return (
    <BaseModal isOpen onClose={onClose} titleId="recipe-alternative-modal" size="lg">
      <div className="flex flex-col gap-4 p-5" data-testid="recipe-alternative-modal">
        {/* header — with a sigil preview built from the recipe's own icon/color */}
        <div className="flex items-start gap-3">
          <span
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0 text-lg"
            style={{ background: `radial-gradient(circle at 50% 35%, ${colorWithAlpha(sigilColor, 0.32)}, transparent 72%)`, border: `1px solid ${colorWithAlpha(sigilColor, 0.5)}` }}
            aria-hidden
          >
            {isEmoji(recipe?.icon ?? null) ? recipe!.icon : <Sparkles className="w-5 h-5" style={{ color: sigilColor }} />}
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

            {dimensions.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="typo-label text-foreground">Dimensions you can tune · {dimensions.length}</span>
                <div className="flex flex-wrap gap-1.5">
                  {dimensions.map((d) => (
                    <span key={d} className="typo-caption px-2.5 py-1 rounded-full border capitalize" style={{ borderColor: colorWithAlpha(sigilColor, 0.3), background: colorWithAlpha(sigilColor, 0.08), color: "var(--color-foreground)" }}>{d}</span>
                  ))}
                </div>
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
