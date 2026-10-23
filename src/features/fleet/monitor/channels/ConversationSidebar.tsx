import { memo, useEffect, useMemo, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { usePipelineStore } from '@/stores/pipelineStore';
import type { Persona } from '@/lib/bindings/Persona';
import { useMonitorVisible } from '../monitorVisibility';
import { Engraved } from '../grid/prototype/entry-e/parts';
import type { Ask } from './needsYouModel';
import { PersonaThreadRow } from './PersonaThreadRow';
import { ProjectRow } from './ProjectRow';
import type { StreamTeam } from './types';

/* ----------------------------------------------------------------------------
 * PROJECTS PLATE - the messenger's conversation list (WP12: the Stewards row
 * grammar). ONE line per project (`ProjectRow`), then the persona
 * conversations (`PersonaThreadRow`), all on one grid under two engraved
 * column heads, NEW and YOU. The plate owns the coarse minute clock presence
 * ages on, and counts each row's asks from the one pending-asks read.
 * -------------------------------------------------------------------------- */

/** How many asks a set of personas holds; `null` while the queue is unread or unreadable. */
function countFor(asks: readonly Ask[], readable: boolean, ids: ReadonlySet<string>): number | null {
  if (!readable) return null;
  let n = 0;
  for (const a of asks) if (ids.has(a.personaId)) n++;
  return n;
}

export const ConversationSidebar = memo(function ConversationSidebar({
  teams, personas, activeId, activePersonaId, onSelect, onSelectPersona, asks, asksReadable,
}: {
  teams: StreamTeam[];
  /** Personas eligible for a conversation row (the workspace's roster). */
  personas?: Persona[];
  activeId: string | null;
  activePersonaId?: string | null;
  onSelect: (teamId: string) => void;
  onSelectPersona?: (personaId: string) => void;
  /** The fleet's pending asks (the You figure and lamp per row). */
  asks: readonly Ask[];
  asksReadable: boolean;
}) {
  const { t } = useTranslation();
  const monitorVisible = useMonitorVisible();

  const loadPreviews = usePipelineStore((s) => s.loadPersonaChannelPreviews);
  const previews = usePipelineStore((s) => s.personaChannelPreviews);

  const enabled = useMemo(() => (personas ?? []).filter((p) => p.enabled), [personas]);

  // One preview read per persona missing one — idempotent across remounts.
  useEffect(() => {
    const missing = enabled.filter((p) => !(p.id in previews)).map((p) => p.id);
    if (missing.length) void loadPreviews(missing);
    // `previews` is deliberately read fresh but not a dep: reacting to its own
    // write would re-run for nothing (the `in` guard makes the call idempotent
    // anyway; this just skips the churn).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, loadPreviews]);

  // Personas with a channel, newest conversation first. Loaded-empty (null)
  // and not-yet-loaded (absent) both stay hidden.
  const withChannel = useMemo(
    () =>
      enabled
        .filter((p) => previews[p.id])
        .sort((a, b) => (previews[b.id]?.at ?? '').localeCompare(previews[a.id]?.at ?? '')),
    [enabled, previews],
  );

  // Presence ages out on its own (PRESENCE_WORK_WINDOW_MS), so a coarse minute
  // clock re-derives it. Gated on visibility: the Monitor stays mounted when
  // closed, and nothing should tick behind a hidden subtree.
  const [presenceNow, setPresenceNow] = useState(() => Date.now());
  useEffect(() => {
    if (!monitorVisible) return;
    setPresenceNow(Date.now());
    const id = setInterval(() => setPresenceNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, [monitorVisible]);

  const teamAsks = useMemo(
    () => new Map(teams.map((tm) => [tm.teamId, countFor(asks, asksReadable, new Set(tm.members.map((mb) => mb.personaId)))])),
    [teams, asks, asksReadable],
  );
  const m = t.monitor;

  return (
    <section className="ae-plate flex h-full min-h-0 flex-col overflow-hidden rounded-card" data-testid="conv-projects">
      <div className="flex h-11 flex-shrink-0 items-center gap-1 border-b border-border pl-3.5 pr-3.5">
        <Engraved className="min-w-0 flex-1 truncate">{m.conv_projects}</Engraved>
        <Engraved className="w-8 flex-shrink-0 text-right">{m.cv_col_new}</Engraved>
        <Engraved className="w-8 flex-shrink-0 text-right">{m.cv_col_you}</Engraved>
        <span className="w-2 flex-shrink-0" />
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-1.5 space-y-0.5">
        {teams.map((tm) => (
          <ProjectRow
            key={tm.teamId}
            tm={tm}
            active={tm.teamId === activeId}
            onSelect={onSelect}
            presenceNow={presenceNow}
            asks={teamAsks.get(tm.teamId) ?? null}
          />
        ))}

        {onSelectPersona && withChannel.length > 0 && (
          <>
            <div className="px-2 pt-3 pb-1">
              <Engraved>{m.conv_persona_group}</Engraved>
            </div>
            {withChannel.map((p) => (
              <PersonaThreadRow
                key={p.id}
                persona={p}
                active={p.id === activePersonaId}
                onSelect={onSelectPersona}
                asks={countFor(asks, asksReadable, new Set([p.id]))}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
});
