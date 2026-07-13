/* eslint-disable custom/no-hardcoded-jsx-text -- prototype variant; i18n at consolidation (plan P6). */
import { memo } from 'react';
import { Radio } from 'lucide-react';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { usePipelineStore } from '@/stores/pipelineStore';
import { channelKey, countUnread, EMPTY_CHANNEL } from '@/stores/slices/pipeline/channelSlice';
import { derivePresence } from '@/features/teams/sub_collab/useTeamChannel';
import type { StreamTeam } from './types';

/* ----------------------------------------------------------------------------
 * PROJECTS SIDEBAR — the messenger's conversation list.
 *
 * One row per team, read straight out of the shared channel cache: last message
 * preview, its time, the UNREAD BADGE (the D6 watermark built in P0, which had
 * no consumer until now), how many personas are working, and a pulse when the
 * team has a live deliberation.
 *
 * Not the design question — both variants use it unchanged — so it's shared
 * from the start rather than duplicated and reconciled later.
 * -------------------------------------------------------------------------- */

const cleanName = (n: string) => n.replace(/^SDLC[ —-]*/i, '') || n;

function previewOf(body: string | null | undefined): string {
  if (!body) return '—';
  return body.replace(/\s+/g, ' ').slice(0, 60);
}

export const ConversationSidebar = memo(function ConversationSidebar({
  teams, activeId, onSelect,
}: {
  teams: StreamTeam[];
  activeId: string | null;
  onSelect: (teamId: string) => void;
}) {
  const channels = usePipelineStore((s) => s.channels);

  return (
    <div className="h-full flex flex-col min-h-0 border-r border-border bg-foreground/[0.012]">
      <div className="flex-shrink-0 h-9 px-3 flex items-center border-b border-border">
        <span className="typo-label uppercase tracking-wider text-foreground opacity-60">Projects</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
        {teams.map((tm) => {
          const st = channels[channelKey(tm.teamId)] ?? EMPTY_CHANNEL;
          const newest = st.items[0];
          const unread = countUnread(st);
          const presence = derivePresence(st.items);
          let working = 0;
          for (const p of presence.values()) if (p === 'working') working++;
          const hasDeliberation = st.items.some((i) => i.deliberationId);
          const active = tm.teamId === activeId;

          return (
            <button
              key={tm.teamId}
              type="button"
              onClick={() => onSelect(tm.teamId)}
              aria-current={active}
              className={`w-full flex items-start gap-2.5 px-2 py-2 rounded-card text-left transition-colors ${
                active ? 'bg-primary/12' : 'hover:bg-secondary/30'
              }`}
            >
              {/* Crest — the channel's identity colour, per plan §5.2 */}
              <span
                className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center typo-caption font-semibold"
                style={{ backgroundColor: `${tm.teamColor}22`, color: tm.teamColor, border: `1px solid ${tm.teamColor}55` }}
              >
                {cleanName(tm.teamName).slice(0, 2).toUpperCase()}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className={`typo-body truncate ${active ? 'text-foreground font-medium' : 'text-foreground'}`}>
                    {cleanName(tm.teamName)}
                  </span>
                  {hasDeliberation && (
                    <Radio className="w-3 h-3 flex-shrink-0 text-violet-300 animate-pulse" aria-label="deliberation active" />
                  )}
                  {newest && (
                    <span className="ml-auto flex-shrink-0 typo-caption text-foreground opacity-45">
                      <RelativeTime timestamp={newest.at} />
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-1.5 mt-0.5">
                  <span className="typo-caption text-foreground opacity-55 truncate">
                    {previewOf(newest?.body)}
                  </span>
                  {unread > 0 && (
                    <span className="ml-auto flex-shrink-0 min-w-[1.25rem] px-1 h-5 rounded-full bg-primary/25 text-foreground typo-caption font-medium tabular-nums flex items-center justify-center">
                      {unread > 99 ? '99+' : unread}
                    </span>
                  )}
                </span>
                {working > 0 && (
                  <span className="mt-1 inline-flex items-center gap-1 typo-caption text-status-info">
                    <span className="w-1.5 h-1.5 rounded-full bg-status-info animate-pulse" />
                    {working} working
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
});
