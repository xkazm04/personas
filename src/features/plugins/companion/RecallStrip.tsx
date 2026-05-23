import { useMemo, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { BrainKind, CompanionRecallPreview } from '@/api/companion';

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
 * Stage 2: when `onOpenInBrain` is provided each chip becomes a button
 * that opens the Brain Viewer scoped to that entry. Stage 1 callers
 * (tests, plugin-page previews) can omit the prop — the chips degrade
 * to read-only spans.
 */
export function RecallStrip({
  preview,
  onOpenInBrain,
}: {
  preview: CompanionRecallPreview;
  onOpenInBrain?: (kind: BrainKind, id: string) => void;
}) {
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
      className="rounded-card border border-foreground/10 bg-secondary/40 px-3 py-1.5 typo-caption text-foreground"
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
            kind="doctrine"
            onOpen={onOpenInBrain}
          />
          <ChipGroup
            label={t.plugins.companion.recall_group_facts}
            entries={preview.facts}
            kind="fact"
            onOpen={onOpenInBrain}
          />
          <ChipGroup
            label={t.plugins.companion.recall_group_procedurals}
            entries={preview.procedurals}
            kind="procedural"
            onOpen={onOpenInBrain}
          />
          <ChipGroup
            label={t.plugins.companion.recall_group_goals}
            entries={preview.goals}
            kind="goal"
            onOpen={onOpenInBrain}
          />
          <ChipGroup
            label={t.plugins.companion.recall_group_backlog}
            entries={preview.backlog}
            kind="backlog"
            onOpen={onOpenInBrain}
          />
        </div>
      )}
    </div>
  );
}

function ChipGroup({
  label,
  entries,
  kind,
  onOpen,
}: {
  label: string;
  entries: { id: string; title: string }[];
  kind: BrainKind;
  onOpen?: (kind: BrainKind, id: string) => void;
}) {
  const { t } = useTranslation();
  if (entries.length === 0) return null;
  const baseClass =
    'rounded-interactive bg-foreground/[0.06] border border-foreground/10 px-1.5 py-0.5 text-foreground';
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-foreground shrink-0">{label}</span>
      {entries.map((e) => {
        const clickable = !!onOpen && !!e.id;
        if (!clickable) {
          return (
            <span key={e.id || e.title} className={baseClass}>
              {e.title}
            </span>
          );
        }
        const ariaLabel = t.plugins.companion.recall_open_in_brain.replace(
          '{title}',
          e.title,
        );
        return (
          <button
            key={e.id || e.title}
            type="button"
            onClick={() => onOpen!(kind, e.id)}
            className={`${baseClass} text-left hover:bg-foreground/[0.10] hover:border-primary/30 transition-colors focus-ring cursor-pointer`}
            title={ariaLabel}
            aria-label={ariaLabel}
            data-testid="companion-recall-chip"
            data-kind={kind}
            data-id={e.id}
          >
            {e.title}
          </button>
        );
      })}
    </div>
  );
}
