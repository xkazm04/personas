/**
 * The Ideas tray under the track: the project's brainstorm notes that are no
 * milestone's brief yet. A chip opens the Notepad on the project; "Make
 * milestone" promotes the note into a cut through the notepad store's own
 * door (`promoteNote`), so this surface never writes a milestone itself.
 *
 * After a promotion both the portfolio and the canvas lanes are reloaded, so
 * the new milestone's station appears on the track.
 */
import { Flag, StickyNote } from 'lucide-react';

import { AsyncButton, Button } from '@/features/shared/components/buttons';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { promoteNote } from '@/features/notepad/notepadStore';
import { toastCatch } from '@/lib/silentCatch';
import type { DevNote } from '@/lib/bindings/DevNote';
import { useSystemStore } from '@/stores/systemStore';

import { useProgressView } from '../../canvasHost';

export function IdeasTray({ projectId, ideas }: { projectId: string; ideas: readonly DevNote[] }) {
  const { model, canvas, dl } = useProgressView();
  if (ideas.length === 0) return null;

  const openPad = () => useSystemStore.getState().notepadOpenForProject(projectId);
  const promote = (id: string) =>
    promoteNote(id)
      .then((done) => {
        if (!done) return;
        model.refresh();
        canvas.reload();
      })
      .catch(toastCatch('GoalsLayers.track.promoteIdea'));

  return (
    <section
      aria-label={dl.layers_ideas}
      data-testid="layers-track-ideas"
      className="flex items-center gap-3 px-4 py-2.5 border-t border-primary/10 bg-secondary/10"
    >
      <Tooltip content={dl.layers_ideas_hint}>
        <span className="flex items-center gap-1.5 shrink-0 typo-eyebrow text-foreground">
          <StickyNote className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
          {dl.layers_ideas}
          <span className="tabular-nums">{ideas.length}</span>
        </span>
      </Tooltip>
      <ul className="typo-body flex items-center gap-2 overflow-x-auto min-w-0 py-0.5">
        {ideas.map((n) => (
          <li
            key={n.id}
            data-testid={`layers-track-idea-${n.id}`}
            className="flex items-center shrink-0 rounded-full border border-primary/20 bg-card/50 pl-1 pr-0.5"
          >
            <Tooltip content={dl.layers_open_note}>
              <Button
                variant="ghost"
                size="xs"
                onClick={openPad}
                data-testid={`layers-track-idea-open-${n.id}`}
                className="rounded-full max-w-[16rem] text-foreground [&>span]:min-w-0 [&>span]:truncate"
              >
                {n.title}
              </Button>
            </Tooltip>
            <AsyncButton
              variant="ghost"
              size="xs"
              icon={<Flag className="w-3 h-3" aria-hidden="true" />}
              onClick={() => promote(n.id)}
              data-testid={`layers-track-idea-promote-${n.id}`}
              className="rounded-full text-primary"
            >
              <span className="typo-caption text-primary">{dl.layers_promote_idea}</span>
            </AsyncButton>
          </li>
        ))}
      </ul>
    </section>
  );
}
