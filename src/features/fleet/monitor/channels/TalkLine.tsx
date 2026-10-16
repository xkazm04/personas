import { memo } from 'react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { PersonaIcon } from '@/features/agents/components/PersonaIcon';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { AUTHOR_KIND_META, authorName, itemAccent } from '@/features/teams/sub_collab/collabRender';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';

/* ----------------------------------------------------------------------------
 * TALK LINE - something someone said in the channel (WP12, the bay's grammar).
 *
 * A persona speaks beside its own glyph tile (the avatar the roster, the grid
 * and the bays draw), its name in its colour at heading weight; Athena, the
 * Director and a bridged Slack human wear their kind's glyph in the same tile.
 * The operator's own lines sit right, in the primary tint, with no name. A
 * machine event is one caption line, never a bubble. Opening a line shows its
 * detail (and its pin to team memory), as before.
 * -------------------------------------------------------------------------- */

/** Chat-tightened markdown: a two-line remark does not inherit document spacing. */
export const MD_CHAT_RHYTHM =
  'break-words [&_p]:mb-1.5 [&_p:last-child]:mb-0 [&_ul]:mb-1.5 [&_ul:last-child]:mb-0 ' +
  '[&_ol]:mb-1.5 [&_ol:last-child]:mb-0 [&_pre]:mb-1.5 [&_table]:my-2 [&_h1]:mt-2 [&_h2]:mt-2 [&_h3]:mt-1.5';

const VOICE_KINDS = new Set(['athena', 'director', 'slack']);

function Glyph({ item }: { item: TeamChannelItem }) {
  const persona = usePersonaIndex().get(item.personaId ?? '');
  if (VOICE_KINDS.has(item.kind)) {
    const M = AUTHOR_KIND_META[item.kind as 'athena' | 'director' | 'slack'];
    return (
      <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-card border border-border bg-secondary/40" aria-hidden>
        <M.Icon className={`h-3.5 w-3.5 ${M.iconColor}`} />
      </span>
    );
  }
  if (!persona) return <span className="h-7 w-7 flex-shrink-0" aria-hidden />;
  return <PersonaIcon icon={persona.icon} color={persona.color} display="framed" frameSize="md" />;
}

/** memo: `item` keeps identity across quiet refreshes and `onOpen` is a setter. */
export const TalkLine = memo(function TalkLine({ item, onOpen }: { item: TeamChannelItem; onOpen: (i: TeamChannelItem) => void }) {
  const persona = usePersonaIndex().get(item.personaId ?? '');
  const mine = item.kind === 'directive';

  if (item.kind === 'event') {
    return (
      <div className="flex items-center gap-2 py-0.5 pl-9">
        <span className="typo-code flex-shrink-0 text-foreground">{item.label}</span>
        <span className="min-w-0 truncate typo-caption">{item.body}</span>
      </div>
    );
  }

  // A div with a role, not a <button>: the body renders markdown whose links
  // must stay real anchors (nested interactives are not valid).
  const bubble = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(item)}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        if ((e.target as HTMLElement).tagName === 'A') return;
        e.preventDefault();
        onOpen(item);
      }}
      className={`focus-ring min-w-0 max-w-[78%] cursor-pointer rounded-card border px-3 py-2 text-left transition-colors ${
        mine ? 'border-primary/20 bg-primary/12 hover:bg-primary/18' : 'border-border bg-secondary/30 hover:bg-secondary/45'
      }`}
    >
      {!mine && (
        <span className="mb-0.5 flex items-baseline gap-2">
          <span className="typo-heading" style={{ color: itemAccent(item, persona) }}>{authorName(item, persona)}</span>
          <span className="typo-caption"><RelativeTime timestamp={item.at} /></span>
        </span>
      )}
      <MarkdownRenderer content={item.body ?? ''} className={`typo-body text-foreground ${MD_CHAT_RHYTHM}`} />
    </div>
  );

  if (mine) return <div className="flex justify-end py-1">{bubble}</div>;
  return (
    <div className="flex items-start gap-2.5 py-1">
      <Glyph item={item} />
      {bubble}
    </div>
  );
});
