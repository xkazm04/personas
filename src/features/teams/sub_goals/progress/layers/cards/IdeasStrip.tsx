/**
 * L1's IDEAS tray: the project's brainstorm drafts as small sticky notes. A
 * note opens the Notepad on the project; "Make milestone" promotes it - the
 * draft mints its milestone and becomes that milestone's brief, which is the
 * whole fusion in one click.
 */
import { Lightbulb, Milestone } from 'lucide-react';

import { useTranslation } from '@/i18n/useTranslation';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { promoteNote } from '@/features/notepad/notepadStore';
import type { DevNote } from '@/lib/bindings/DevNote';
import { toastCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';

import { useProgressView } from '../../canvasHost';
import { briefExcerpt } from './cardsModel';
import { CardShell } from './CardShell';

/** Notes tilt a little, alternately - a desk, not a table. Static, so no motion to reduce. */
const TILT = ['-rotate-1', 'rotate-1', 'rotate-0'] as const;

export function IdeasStrip({ projectId, ideas }: { projectId: string; ideas: DevNote[] }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  if (ideas.length === 0) return null;
  return (
    <section className="mt-6" data-testid="layers-cards-ideas" aria-label={dl.layers_ideas}>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="inline-flex items-center gap-1.5 typo-heading text-foreground">
          <Lightbulb className="w-4 h-4 text-role-highlight" aria-hidden />
          {dl.layers_ideas}
        </span>
        <span className="typo-caption">{dl.layers_ideas_hint}</span>
      </div>
      <div className="flex flex-wrap gap-4">
        {ideas.map((note, i) => (
          <StickyNote key={note.id} note={note} projectId={projectId} tilt={TILT[i % TILT.length]!} />
        ))}
      </div>
    </section>
  );
}

function StickyNote({ note, projectId, tilt }: { note: DevNote; projectId: string; tilt: string }) {
  const { t } = useTranslation();
  const dl = t.plugins.dev_lifecycle;
  const { model, canvas } = useProgressView();
  const excerpt = briefExcerpt(note.bodyMd, 90);

  const promote = () =>
    promoteNote(note.id)
      .then((promotion) => {
        // `promoteNote` reports its own failure and answers null.
        if (promotion) {
          model.refresh();
          canvas.reload();
        }
      })
      .catch(toastCatch('GoalsLayers.cards.promoteIdea'));

  return (
    <div
      className={`w-52 flex flex-col rounded-card border border-role-highlight/25 bg-role-highlight/10 shadow-elevation-1 ${tilt} hover:rotate-0 transition-transform duration-200 motion-reduce:transition-none`}
      data-testid={`layers-cards-idea-${note.id}`}
    >
      <CardShell
        onPress={() => useSystemStore.getState().notepadOpenForProject(projectId)}
        testId={`layers-cards-idea-open-${note.id}`}
        className="flex flex-col gap-1.5 px-3.5 pt-3 pb-2 rounded-card"
      >
        <span className="typo-heading text-foreground line-clamp-2">{note.title || dl.layers_open_note}</span>
        {excerpt && <span className="typo-body text-foreground line-clamp-3">{excerpt}</span>}
      </CardShell>
      <div className="px-3 pb-3 pt-1">
        <AsyncButton
          variant="accent"
          tone="highlight"
          size="xs"
          icon={<Milestone className="w-3.5 h-3.5" />}
          onClick={promote}
          data-testid={`layers-cards-idea-promote-${note.id}`}
        >
          {dl.layers_promote_idea}
        </AsyncButton>
      </div>
    </div>
  );
}
