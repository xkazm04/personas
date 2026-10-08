/**
 * The project's IDEAS: brainstorm notes not yet any milestone's brief, as a
 * row of pills. A pill opens the Notepad on the project; "Make milestone"
 * promotes the note - the backend creates the milestone and makes the note its
 * brief, which is the fusion the layers exist for: an idea becomes a cut
 * without being copied anywhere.
 */
import { Lightbulb, Flag } from 'lucide-react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { promoteNote } from '@/features/notepad/notepadStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { DevNote } from '@/lib/bindings/DevNote';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { useProgressView } from '../../canvasHost';
import { BAND_HEAD_W } from './Band';

export function IdeasRow({ projectId, ideas }: { projectId: string; ideas: readonly DevNote[] }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { model, canvas } = useProgressView();

  const openPad = () => useSystemStore.getState().notepadOpenForProject(projectId);
  // `promoteNote` reports its own failure and resolves `null`; the toastCatch
  // covers the refresh that follows it.
  const promote = (id: string) =>
    promoteNote(id)
      .then((promotion) => {
        if (!promotion) return;
        // Both reads: the goals (`model`) and the cuts (`canvas`), so the
        // promoted milestone appears as a band without a remount.
        model.refresh();
        canvas.reload();
      })
      .catch(toastCatch('GoalsLayers.bands.promoteIdea'));

  return (
    <section
      className="flex items-stretch rounded-card border border-primary/15 bg-primary/[0.04]"
      aria-label={dl.layers_ideas}
      data-testid="layers-bands-ideas"
    >
      <div className="shrink-0 flex flex-col justify-center gap-1 px-4 py-3 border-r border-primary/10" style={{ width: BAND_HEAD_W }}>
        <span className="inline-flex items-center gap-2 typo-heading text-foreground">
          <Lightbulb className="w-4 h-4 text-primary" aria-hidden="true" />
          {dl.layers_ideas}
        </span>
        <span className="typo-caption">{dl.layers_ideas_hint}</span>
      </div>
      <div className="flex-1 min-w-0 flex flex-wrap items-center gap-2 px-3 py-3">
        {ideas.map((note) => (
          <div
            key={note.id}
            className="inline-flex items-center gap-0.5 rounded-full border border-primary/25 bg-primary/10 pl-1 pr-1"
            data-testid={`layers-bands-idea-${note.id}`}
          >
            <Button
              variant="ghost"
              size="sm"
              onClick={openPad}
              aria-label={`${dl.layers_open_note}: ${note.title || dl.layers_open_note}`}
              data-testid={`layers-bands-idea-open-${note.id}`}
              className="rounded-full typo-body max-w-[260px]"
            >
              <span className="truncate">{note.title || dl.layers_open_note}</span>
            </Button>
            <AsyncButton
              variant="accent"
              tone="agent"
              size="xs"
              icon={<Flag className="w-3 h-3" />}
              onClick={() => promote(note.id)}
              data-testid={`layers-bands-idea-promote-${note.id}`}
              className="rounded-full"
            >
              {dl.layers_promote_idea}
            </AsyncButton>
          </div>
        ))}
      </div>
    </section>
  );
}
