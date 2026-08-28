import { useMemo, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type {
  BrainKind,
  CompanionRecallPreview,
  CompanionRecallPreviewEntry,
} from '@/api/companion';
import { RecallChip } from './RecallChip';

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
            className="inline-flex items-center gap-0.5 rounded-interactive bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-primary"
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
          <FloorNote preview={preview} />
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
  entries: CompanionRecallPreviewEntry[];
  kind: BrainKind;
  onOpen?: (kind: BrainKind, id: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-wrap items-baseline gap-1.5">
      <span className="text-foreground shrink-0">{label}</span>
      {entries.map((e) => (
        <RecallChip
          key={e.id || e.title}
          entry={e}
          kind={kind}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

/**
 * What retrieval measured and then rejected.
 *
 * Only rendered when a floor was actually applied — a build with no vector
 * lane has no threshold, and printing one would describe a mechanism that did
 * not run. Without this line an unexpectedly thin recall is indistinguishable
 * from a brain that had nothing to say, which is the state that made
 * `MAX_VECTOR_DISTANCE` a number nobody could tune.
 */
function FloorNote({ preview }: { preview: CompanionRecallPreview }) {
  const { t } = useTranslation();
  // `== null` catches undefined as well as null on purpose. The strip renders
  // whatever the backend event carried, and a payload built before these
  // fields existed must degrade to "no note" rather than take the chat
  // surface down over a diagnostic footer.
  const floor = preview.relevanceFloor;
  if (floor == null || !preview.droppedFar) return null;
  return (
    <p
      className="border-t border-foreground/10 pt-1.5 text-foreground"
      data-testid="companion-recall-floor-note"
    >
      {t.plugins.companion.recall_dropped_far
        .replace('{count}', String(preview.droppedFar))
        .replace('{floor}', floor.toFixed(2))}
    </p>
  );
}
