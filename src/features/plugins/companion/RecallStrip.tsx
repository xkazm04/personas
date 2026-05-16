import { useMemo, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { CompanionRecallPreview } from '@/api/companion';

/**
 * Per-turn rollup of what Athena's brain pulled into the system prompt.
 * Renders as a single collapsed line above the assistant bubble; clicking
 * the chevron expands it into a grouped chip list (doctrine / facts /
 * procedurals / goals / backlog). Episodes are reported as a count only
 * — they're conversation history, not "consulted memories", and they
 * crowd the chip list when displayed inline.
 *
 * Source: backend's `companion://recall-preview` Tauri event, emitted
 * once per turn right after the prompt builder runs.
 *
 * Stage 1 of 2: surface counts + titles. Stage 2 (future cycle): wire
 * each chip to open the Brain Viewer scoped to that entry.
 */
export function RecallStrip({ preview }: { preview: CompanionRecallPreview }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const totalMemories =
    preview.doctrine.length +
    preview.facts.length +
    preview.procedurals.length +
    preview.goals.length +
    preview.backlog.length;

  const summary = useMemo(() => {
    if (totalMemories === 0 && preview.episodeCount === 0) {
      return t.plugins.companion.recall_empty;
    }
    if (totalMemories === 0) {
      return t.plugins.companion.recall_episodes_only.replace(
        '{count}',
        String(preview.episodeCount),
      );
    }
    if (preview.episodeCount === 0) {
      return t.plugins.companion.recall_memories_only.replace(
        '{count}',
        String(totalMemories),
      );
    }
    return t.plugins.companion.recall_combined
      .replace('{episodes}', String(preview.episodeCount))
      .replace('{memories}', String(totalMemories));
  }, [preview, totalMemories, t]);

  // If literally nothing was consulted (cold start, no episodes, no
  // facts), don't render the strip at all — it would just be visual
  // chrome with no information value.
  if (totalMemories === 0 && preview.episodeCount === 0) {
    return null;
  }

  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div
      className="rounded-card border border-foreground/10 bg-secondary/40 px-3 py-1.5 typo-caption text-foreground/60"
      data-testid="companion-recall-strip"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 w-full text-left hover:text-foreground/85 transition-colors rounded-interactive"
        aria-expanded={open}
      >
        <Chevron className="w-3 h-3" />
        <Brain className="w-3 h-3" />
        <span className="flex-1">{summary}</span>
        {preview.synthesized && (
          <span
            className="inline-flex items-center gap-0.5 text-violet-300/80"
            title={t.plugins.companion.recall_synthesized_tooltip}
          >
            <Sparkles className="w-3 h-3" />
            {t.plugins.companion.recall_synthesized_badge}
          </span>
        )}
      </button>
      {open && totalMemories > 0 && (
        <div className="mt-2 space-y-1.5">
          <ChipGroup
            label={t.plugins.companion.recall_group_doctrine}
            entries={preview.doctrine}
          />
          <ChipGroup
            label={t.plugins.companion.recall_group_facts}
            entries={preview.facts}
          />
          <ChipGroup
            label={t.plugins.companion.recall_group_procedurals}
            entries={preview.procedurals}
          />
          <ChipGroup
            label={t.plugins.companion.recall_group_goals}
            entries={preview.goals}
          />
          <ChipGroup
            label={t.plugins.companion.recall_group_backlog}
            entries={preview.backlog}
          />
        </div>
      )}
    </div>
  );
}

function ChipGroup({
  label,
  entries,
}: {
  label: string;
  entries: { id: string; title: string }[];
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-foreground/45 shrink-0">{label}</span>
      {entries.map((e) => (
        <span
          key={e.id || e.title}
          className="rounded-interactive bg-foreground/[0.06] border border-foreground/10 px-1.5 py-0.5 text-foreground/75"
        >
          {e.title}
        </span>
      ))}
    </div>
  );
}
