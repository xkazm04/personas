import { useState } from "react";
import { Sparkles } from "lucide-react";
import { useTranslation } from "@/i18n/useTranslation";
import { useTemplateIntentMatch } from "@/features/agents/components/create/useTemplateIntentMatch";
import type { CompanionTemplateMatch } from "@/api/companion";

interface PersonaOverviewTemplateMatchesProps {
  /** Start the creator seeded with this intent (and the match's name, if any). */
  onStart: (intent: string, match: CompanionTemplateMatch | null) => void;
}

/**
 * Intent field + ranked template matches for a roster with no agents at all.
 *
 * The first-run empty state used to offer exactly one action - Create - which
 * dropped the user into an unguided wizard with a blank glyph, while the same
 * context already owned `useTemplateIntentMatch` (the fast lexical matcher, no
 * LLM, 8-char gate, 300ms debounce) and nothing on this page used it. Typing
 * what you want now ranks the published corpus; picking a match seeds the
 * creator with that intent so the build surface can offer its adoption card
 * for the template you already chose, instead of starting from nothing.
 *
 * Create-from-scratch stays available above this block.
 */
export function PersonaOverviewTemplateMatches({
  onStart,
}: PersonaOverviewTemplateMatchesProps) {
  const { t } = useTranslation();
  const [intent, setIntent] = useState("");
  const { matches, loading } = useTemplateIntentMatch(intent);

  const trimmed = intent.trim();
  const submit = () => {
    if (!trimmed) return;
    onStart(trimmed, null);
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-3 pb-8">
      <p className="typo-label text-foreground text-center">
        {t.home.setup.describe_goal}
      </p>
      <input
        type="text"
        value={intent}
        onChange={(e) => setIntent(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        data-testid="roster-empty-intent"
        aria-label={t.home.setup.describe_goal}
        placeholder={t.agents.glyph_intent_placeholder}
        className="w-full px-3 py-2 typo-body rounded-input bg-secondary/40 border border-primary/15 text-foreground placeholder:text-foreground/60 focus-visible:outline-none focus-visible:border-primary/40 transition-colors"
      />
      {/* The live region is mounted with the field, not with its first result:
          a region created together with its content announces nothing. */}
      <div className="space-y-1.5" aria-live="polite">
        {trimmed.length > 0 && (
          <>
            {matches.length > 0 && (
              <p className="typo-caption uppercase tracking-wide text-primary/80">
                {t.agents.build_template_match_label}
              </p>
            )}
            {matches.map((m) => (
              <button
                key={m.id}
                type="button"
                data-testid={`roster-empty-template-${m.id}`}
                onClick={() => onStart(trimmed, m)}
                className="w-full flex items-start gap-2.5 rounded-card border border-primary/15 bg-secondary/25 px-3 py-2 text-left hover:bg-secondary/40 hover:border-primary/30 transition-colors focus-ring cursor-pointer"
              >
                <Sparkles
                  className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary"
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block typo-body text-foreground truncate">
                    {m.name}
                  </span>
                  {m.snippet && (
                    <span className="block typo-caption text-foreground/85 line-clamp-2">
                      {m.snippet}
                    </span>
                  )}
                </span>
              </button>
            ))}
            {/* No match is a normal outcome, not a dead end: the typed intent
              still starts the creator, seeded. */}
            {matches.length === 0 && !loading && (
              <button
                type="button"
                data-testid="roster-empty-start-from-intent"
                onClick={submit}
                className="w-full rounded-card border border-primary/15 bg-secondary/25 px-3 py-2 typo-body text-foreground text-left hover:bg-secondary/40 transition-colors focus-ring cursor-pointer"
              >
                {t.agents.editor_empty.create}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
