import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Sparkles, ArrowRight, LayoutGrid, Wand2 } from "lucide-react";
import { useSystemStore } from "@/stores/systemStore";
import { useTranslation } from "@/i18n/useTranslation";
import { useTemplateGallery } from "@/hooks/design/template/useTemplateGallery";
import { getDesignReview } from "@/api/overview/reviews";
import { silentCatchNull } from "@/lib/silentCatch";
import type { PersonaDesignReview } from "@/lib/bindings/PersonaDesignReview";
import AdoptionWizardModal from "@/features/templates/sub_generated/adoption/AdoptionWizardModal";
import { LoadingSpinner } from "@/features/shared/components/feedback/LoadingSpinner";
import { useTemplateIntentMatch } from "./useTemplateIntentMatch";

/**
 * PersonaCreator — the unified creation front door (glyph-convergence P1+P2).
 *
 * One describe-first entry that offers both on-ramps:
 *   • a big autofocus describe box → the from-scratch build. It hands off by
 *     seeding `companionPrefill.intent` and asking the parent to dismiss the
 *     launcher, after which UnifiedBuildEntry reads that prefill — the same
 *     proven bridge Athena's "Build it for me" widget uses.
 *   • a template row that LIVE-MATCHES what the user types (P2): once the
 *     intent is substantial, the row swaps the curated starters for templates
 *     ranked against the description (via companion_match_templates), turning a
 *     vague sentence into a one-click proven start. A match carries only a
 *     reviewId, so clicking fetches the full review before opening the existing
 *     adoption flow; "Browse all" jumps to the full gallery.
 *
 * Purely additive — both back-half flows are unchanged. Later phases (see
 * docs/concepts/glyph-convergence.md) host adoption in-page, fold in instant
 * adopt, and merge the build surfaces.
 */
interface PersonaCreatorProps {
  /** Called when the user commits a from-scratch description — the parent
   *  dismisses the launcher and renders the build surface, which reads the
   *  seeded intent from companionPrefill. */
  onStartDescribe: () => void;
  /** Bubbled from the adoption modal when a template-built persona lands. */
  onPersonaCreated: (personaId: string) => void;
}

const MAX_STARTERS = 6;

interface StarterCardProps {
  title: string;
  /** Optional one-line subtitle — a match rationale or the template's instruction. */
  subtitle?: string;
  ariaLabel: string;
  onClick: () => void;
}

/** One template card — shared by the curated-starter and live-match rows. */
function StarterCard({ title, subtitle, ariaLabel, onClick }: StarterCardProps) {
  const initial = title.trim().charAt(0).toUpperCase() || "?";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="group flex items-start gap-3 rounded-card border border-border/30 bg-foreground/[0.03] hover:border-primary/40 hover:bg-primary/[0.05] px-3 py-3 text-left transition-colors cursor-pointer"
      data-testid="persona-creator-starter"
    >
      <span className="shrink-0 w-9 h-9 rounded-input flex items-center justify-center typo-body font-semibold bg-primary/15 border border-primary/30 text-primary">
        {initial}
      </span>
      <span className="flex-1 min-w-0 flex flex-col gap-0.5">
        <span className="typo-body font-medium text-foreground truncate">{title}</span>
        {subtitle && (
          <span className="typo-caption text-foreground/65 line-clamp-2 leading-snug">{subtitle}</span>
        )}
      </span>
    </button>
  );
}

export function PersonaCreator({ onStartDescribe, onPersonaCreated }: PersonaCreatorProps) {
  const { t } = useTranslation();
  const setCompanionPrefill = useSystemStore((s) => s.setCompanionPrefill);
  const setSidebarSection = useSystemStore((s) => s.setSidebarSection);
  // Small first page — we only show a handful of starters here; "Browse all"
  // opens the full gallery.
  const gallery = useTemplateGallery(undefined, MAX_STARTERS * 2);

  const [intent, setIntent] = useState("");
  const [adoptReview, setAdoptReview] = useState<PersonaDesignReview | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // P2 — live template matches for the typed intent (debounced, best-effort).
  const { matches: liveMatches } = useTemplateIntentMatch(intent, MAX_STARTERS);
  const showMatches = liveMatches.length > 0;

  useEffect(() => {
    const id = setTimeout(() => textareaRef.current?.focus(), 60);
    return () => clearTimeout(id);
  }, []);

  // Prefer the gallery's curated "recommended" set; fall back to the first
  // page of all items so the row is never empty when recommendations lag.
  const starters = useMemo<PersonaDesignReview[]>(() => {
    const pool = gallery.recommendedTemplates.length > 0 ? gallery.recommendedTemplates : gallery.allItems;
    return pool.slice(0, MAX_STARTERS);
  }, [gallery.recommendedTemplates, gallery.allItems]);

  const submitDescribe = useCallback(() => {
    const trimmed = intent.trim();
    if (!trimmed) return;
    // Seed the build surface with the intent but do NOT auto-launch — the
    // user lands on the prefilled compose box and presses Build there, so
    // they can still tweak quick-config first.
    setCompanionPrefill({ intent: trimmed, name: null, autoLaunch: false });
    onStartDescribe();
  }, [intent, setCompanionPrefill, onStartDescribe]);

  const handleKey = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        submitDescribe();
      }
    },
    [submitDescribe],
  );

  const browseAll = useCallback(() => {
    setSidebarSection("design-reviews");
  }, [setSidebarSection]);

  // A live match only carries the review id — fetch the full review before
  // handing it to the adoption modal. Best-effort: a failed fetch just
  // no-ops (the user can retry or browse the gallery).
  const adoptById = useCallback(async (reviewId: string) => {
    const review = await getDesignReview(reviewId).catch(
      silentCatchNull("PersonaCreator.adoptById"),
    );
    if (review) setAdoptReview(review);
  }, []);

  const ariaFor = useCallback(
    (name: string) => t.agents.create_starter_aria.replace("{name}", name),
    [t],
  );

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto" data-testid="persona-creator">
      <div className="mx-auto w-full max-w-[760px] flex flex-col items-stretch gap-8 px-6 py-12">
        {/* Describe-first */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary/85" />
            <h1 className="typo-heading-md font-semibold text-foreground">{t.agents.create_heading}</h1>
          </div>
          <label htmlFor="persona-creator-intent" className="typo-body text-foreground/80">
            {t.agents.create_describe_label}
          </label>
          <div
            className="rounded-modal border border-card-border bg-card-bg/85 backdrop-blur-md p-3 flex flex-col gap-2 shadow-elevation-2"
            style={{ boxShadow: "0 0 22px rgba(96,165,250,0.18), 0 4px 18px rgba(0,0,0,0.30)" }}
          >
            <textarea
              id="persona-creator-intent"
              ref={textareaRef}
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              onKeyDown={handleKey}
              placeholder={t.agents.glyph_intent_placeholder}
              rows={3}
              className="w-full px-3 py-2 rounded-card bg-secondary/30 border border-border/30 typo-body text-foreground placeholder:text-foreground/40 focus:outline-none resize-none"
              data-testid="persona-creator-intent-input"
            />
            <button
              type="button"
              onClick={submitDescribe}
              disabled={!intent.trim()}
              className="self-end inline-flex items-center gap-1.5 px-4 py-1.5 rounded-card border border-primary/40 bg-primary/15 text-foreground hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer typo-body transition-colors"
              data-testid="persona-creator-build-btn"
            >
              {t.agents.create_build_cta}
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Template row — live matches once the intent is substantial,
            otherwise the curated starter set. */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <span className="typo-label uppercase tracking-[0.18em] text-foreground/70 inline-flex items-center gap-1.5">
              {showMatches && <Wand2 className="w-3.5 h-3.5 text-primary/80" />}
              {showMatches ? t.agents.create_match_heading : t.agents.create_templates_heading}
            </span>
            <button
              type="button"
              onClick={browseAll}
              className="inline-flex items-center gap-1.5 typo-caption text-foreground/70 hover:text-primary transition-colors cursor-pointer"
              data-testid="persona-creator-browse-all"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              {t.agents.create_browse_all}
            </button>
          </div>

          {showMatches ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" data-testid="persona-creator-matches">
              {liveMatches.map((m) => (
                <StarterCard
                  key={m.id}
                  title={m.name}
                  subtitle={m.snippet || undefined}
                  ariaLabel={ariaFor(m.name)}
                  onClick={() => void adoptById(m.id)}
                />
              ))}
            </div>
          ) : gallery.isLoading && starters.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <LoadingSpinner />
            </div>
          ) : starters.length === 0 ? (
            <button
              type="button"
              onClick={browseAll}
              className="rounded-card border border-dashed border-border/40 bg-foreground/[0.02] hover:border-primary/40 hover:bg-primary/[0.04] px-4 py-6 text-center typo-body text-foreground/70 transition-colors cursor-pointer"
            >
              {t.agents.create_templates_empty}
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {starters.map((review) => {
                const title = review.test_case_name || review.test_case_id;
                return (
                  <StarterCard
                    key={review.id}
                    title={title}
                    subtitle={review.instruction || undefined}
                    ariaLabel={ariaFor(title)}
                    onClick={() => setAdoptReview(review)}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>

      <AdoptionWizardModal
        isOpen={!!adoptReview}
        review={adoptReview}
        onClose={() => setAdoptReview(null)}
        onPersonaCreated={(personaId) => {
          setAdoptReview(null);
          onPersonaCreated(personaId);
        }}
      />
    </div>
  );
}
