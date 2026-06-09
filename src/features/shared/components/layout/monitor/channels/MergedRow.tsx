import { memo } from 'react';
import { ExternalLink, AlertCircle, Pin, User } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePersonaIndex } from '@/features/teams/sub_teamWorkspace/teamStudio/boardShared';
import { eventFamily } from '@/features/teams/sub_redRoom/useRedRoomFeed';
import { payloadSummary } from '@/features/teams/sub_collab/payloadView';
import { STEP_VERB, STEP_TONE, FAMILY_TEXT, AUTHOR_KIND_META, authorName, itemAccent } from '@/features/teams/sub_collab/collabRender';
import type { TeamChannelItem } from '@/lib/bindings/TeamChannelItem';
import { MERGED_ROW_HEIGHT, type TaggedItem } from './types';

/* The compact one-line row used by the combined Timeline. */

/** Resolve the compact event label + tone + one-line message for any item. */
function resolveCompact(item: TeamChannelItem): { event: string; tone: string; message: string | null; artifact: { url: string; label: string } | null; isError: boolean; alert: boolean } {
  if (item.kind === 'step') {
    return {
      event: STEP_VERB[item.label] ?? item.label,
      tone: STEP_TONE[item.label] ?? 'text-foreground/55',
      message: item.body,
      artifact: null,
      isError: item.label === 'step_failed',
      alert: item.label === 'status_awaiting_review' || item.label === 'step_failed',
    };
  }
  if (item.kind === 'event') {
    const { summary, artifact } = payloadSummary(item.extra);
    return { event: item.label, tone: FAMILY_TEXT[eventFamily(item.label)] ?? FAMILY_TEXT.other!, message: summary, artifact, isError: false, alert: false };
  }
  if (item.kind === 'memory') {
    return { event: `memory · ${item.label}`, tone: 'text-amber-300/80', message: item.body, artifact: null, isError: false, alert: false };
  }
  if (item.kind === 'directive') {
    return { event: 'directive', tone: 'text-status-success', message: item.body, artifact: null, isError: false, alert: false };
  }
  const meta = AUTHOR_KIND_META[item.kind as 'persona' | 'athena' | 'director'] ?? AUTHOR_KIND_META.persona;
  return { event: meta.label, tone: meta.tag, message: item.body, artifact: null, isError: false, alert: false };
}

/**
 * One compact merged-feed row: a team-colour rail + badge, the source persona,
 * the event chip, and a one-line message — clickable to open the full detail.
 * STATIC (no per-row mount animation) because the Timeline virtualizes it:
 * rows mount/unmount as you scroll, so an entry animation would re-fire on
 * every scroll. `memo` keeps re-renders to rows whose props actually changed;
 * height is fixed to {@link MERGED_ROW_HEIGHT} for exact virtualizer math.
 */
export const MergedRow = memo(function MergedRow({
  tagged,
  showTeam,
  personaIndex,
  onOpen,
}: {
  tagged: TaggedItem;
  showTeam: boolean;
  personaIndex: ReturnType<typeof usePersonaIndex>;
  onOpen: (item: TeamChannelItem) => void;
}) {
  const { item, team } = tagged;
  const persona = item.personaId ? personaIndex.get(item.personaId) : undefined;
  const accent = itemAccent(item, persona);
  const source = authorName(item, persona);
  const { event, tone, message, artifact, isError, alert } = resolveCompact(item);

  // Author differentiation — Athena (autonomous) and your directives must NOT
  // read as the same actor. Each non-persona author gets its own avatar + tint.
  const authorMeta = item.kind === 'athena' || item.kind === 'director' ? AUTHOR_KIND_META[item.kind] : null;
  const avatarBg =
    item.kind === 'athena' ? 'bg-violet-500/15'
    : item.kind === 'director' ? 'bg-sky-500/15'
    : item.kind === 'directive' ? 'bg-emerald-500/15'
    : 'bg-secondary/60';
  const rowTint = item.kind === 'athena' ? 'bg-violet-500/[0.05]' : item.kind === 'directive' ? 'bg-emerald-500/[0.04]' : '';

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      style={{ height: MERGED_ROW_HEIGHT, ...(alert ? { boxShadow: 'inset 2px 0 0 var(--color-status-warning, #f59e0b)' } : { boxShadow: `inset 2px 0 0 ${team.teamColor}` }) }}
      className={`w-full text-left flex items-center gap-2 rounded-card px-2.5 hover:bg-foreground/[0.04] transition-colors ${rowTint}`}
    >
      {showTeam && (
        <span className="inline-flex items-center gap-1 flex-shrink-0 typo-caption text-foreground" title={team.teamName}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: team.teamColor }} />
          <span className="max-w-[88px] truncate">{team.teamName.replace(/^SDLC[ —-]*/i, '') || team.teamName}</span>
        </span>
      )}
      <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full flex-shrink-0 ${avatarBg}`}>
        {persona ? <PersonaIcon icon={persona.icon} color={persona.color} size="w-3 h-3" />
          : authorMeta ? <authorMeta.Icon className={`w-3 h-3 ${authorMeta.iconColor}`} />
          : item.kind === 'directive' ? <User className="w-3 h-3 text-emerald-400" />
          : item.kind === 'memory' ? <Pin className="w-3 h-3 text-amber-300/80" />
          : alert ? <AlertCircle className="w-3 h-3 text-status-warning" />
          : <span className="typo-caption text-foreground">·</span>}
      </span>
      <span className="typo-caption font-medium flex-shrink-0 max-w-[110px] truncate" style={{ color: accent }}>{source}</span>
      <span className={`typo-caption uppercase tracking-wider flex-shrink-0 ${tone}`}>{event}</span>
      {message && <span className={`typo-caption truncate ${isError ? 'text-status-error/80' : 'text-foreground/55'}`}>{message}</span>}
      {artifact && <span className="inline-flex items-center gap-0.5 typo-caption text-status-info flex-shrink-0"><ExternalLink className="w-3 h-3" />{artifact.label}</span>}
      <span className="ml-auto typo-caption text-foreground flex-shrink-0"><RelativeTime timestamp={item.at} /></span>
    </button>
  );
});
