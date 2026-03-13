import { useState, useCallback, useRef } from 'react';
import { usePipelineStore } from "@/stores/pipelineStore";
import { createTeamMemory, listTeamMemories } from "@/api/pipeline/teamMemories";
import { addTeamMember, createTeamConnection, listTeamMembers, suggestTopology, suggestTopologyLlm } from "@/api/pipeline/teams";

import type { TopologyBlueprint } from '@/lib/bindings/TopologyBlueprint';
import type { PersonaTeam } from '@/lib/bindings/PersonaTeam';

export type AutoTeamPhase =
  | 'idle'
  | 'suggesting'
  | 'previewing'
  | 'applying'
  | 'seeding'
  | 'done'
  | 'error';

export interface AutoTeamState {
  phase: AutoTeamPhase;
  query: string;
  setQuery: (q: string) => void;
  blueprint: TopologyBlueprint | null;
  createdTeam: PersonaTeam | null;
  memberCount: number;
  connectionCount: number;
  memoriesSeeded: number;
  error: string | null;
  /** Request a topology suggestion for the current query. */
  suggest: () => void;
  /** Apply the previewed blueprint: create team + members + connections + seed memories. */
  apply: () => void;
  /** Reset to idle. */
  reset: () => void;
}

export function useAutoTeam(): AutoTeamState {
  const createTeam = usePipelineStore((s) => s.createTeam);
  const fetchTeams = usePipelineStore((s) => s.fetchTeams);
  const selectTeam = usePipelineStore((s) => s.selectTeam);

  const [phase, setPhase] = useState<AutoTeamPhase>('idle');
  const [query, setQuery] = useState('');
  const [blueprint, setBlueprint] = useState<TopologyBlueprint | null>(null);
  const [createdTeam, setCreatedTeam] = useState<PersonaTeam | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [connectionCount, setConnectionCount] = useState(0);
  const [memoriesSeeded, setMemoriesSeeded] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const cancelledRef = useRef(false);

  const suggest = useCallback(async () => {
    if (!query.trim()) return;
    cancelledRef.current = false;
    setError(null);
    setBlueprint(null);
    setPhase('suggesting');

    try {
      let bp: TopologyBlueprint;
      try {
        bp = await suggestTopologyLlm(query.trim());
      } catch {
        bp = await suggestTopology(query.trim());
      }
      if (cancelledRef.current) return;

      if (bp.members.length === 0) {
        setError('No agents matched your description. Try being more specific.');
        setPhase('error');
        return;
      }

      setBlueprint(bp);
      setPhase('previewing');
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to generate team suggestion');
      setPhase('error');
    }
  }, [query]);

  const apply = useCallback(async () => {
    if (!blueprint) return;
    cancelledRef.current = false;
    setPhase('applying');
    setError(null);

    try {
      // Extract a short name from the description or query
      const teamName = query.trim().length > 40
        ? query.trim().slice(0, 37) + '...'
        : query.trim();

      // 1. Create the team
      const team = await createTeam({
        name: teamName,
        description: blueprint.description,
        color: '#6366f1',
      });

      if (!team) {
        setError('Failed to create team');
        setPhase('error');
        return;
      }
      if (cancelledRef.current) return;

      setCreatedTeam(team);

      // 2. Add members and collect their IDs
      const newMemberIds: string[] = [];
      for (const member of blueprint.members) {
        const added = await addTeamMember(
          team.id,
          member.persona_id,
          member.role,
          member.position_x,
          member.position_y,
        );
        newMemberIds.push(added.id);
      }
      if (cancelledRef.current) return;
      setMemberCount(newMemberIds.length);

      // 3. Create connections
      let connCount = 0;
      for (const conn of blueprint.connections) {
        const sourceId = newMemberIds[conn.source_index];
        const targetId = newMemberIds[conn.target_index];
        if (sourceId && targetId) {
          await createTeamConnection(
            team.id,
            sourceId,
            targetId,
            conn.connection_type,
          );
          connCount++;
        }
      }
      if (cancelledRef.current) return;
      setConnectionCount(connCount);

      // 4. Seed memories from similar past teams
      setPhase('seeding');
      let seeded = 0;

      try {
        // Find teams with overlapping members to pull relevant memories
        const allTeams = usePipelineStore.getState().teams;
        const blueprintPersonaIds = new Set(blueprint.members.map((m) => m.persona_id));

        for (const existingTeam of allTeams) {
          if (existingTeam.id === team.id) continue;

          // Check if this team has overlapping members
          try {
            const existingMembers = await listTeamMembers(existingTeam.id);
            const overlap = existingMembers.some((m) => blueprintPersonaIds.has(m.persona_id));
            if (!overlap) continue;

            // Pull high-importance memories from this team
            const memories = await listTeamMemories(existingTeam.id, undefined, undefined, undefined, 5);
            const highValue = memories.filter((m) => m.importance >= 7);

            for (const mem of highValue) {
              await createTeamMemory({
                team_id: team.id,
                run_id: null,
                member_id: null,
                persona_id: mem.persona_id,
                title: `[Seeded] ${mem.title}`,
                content: mem.content,
                category: mem.category,
                importance: Math.max(mem.importance - 1, 5),
                tags: mem.tags ? `seeded,${mem.tags}` : 'seeded',
              });
              seeded++;
            }
          } catch {
            // Skip teams we can't read
          }

          if (seeded >= 10) break; // Cap seeded memories
        }
      } catch {
        // Memory seeding is best-effort
      }

      setMemoriesSeeded(seeded);
      await fetchTeams();
      setPhase('done');

      // Auto-navigate to the new team after a short pause
      setTimeout(() => selectTeam(team.id), 600);
    } catch (err) {
      if (cancelledRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to create team');
      setPhase('error');
    }
  }, [blueprint, query, createTeam, fetchTeams, selectTeam]);

  const reset = useCallback(() => {
    cancelledRef.current = true;
    setPhase('idle');
    setQuery('');
    setBlueprint(null);
    setCreatedTeam(null);
    setMemberCount(0);
    setConnectionCount(0);
    setMemoriesSeeded(0);
    setError(null);
  }, []);

  return {
    phase,
    query,
    setQuery,
    blueprint,
    createdTeam,
    memberCount,
    connectionCount,
    memoriesSeeded,
    error,
    suggest,
    apply,
    reset,
  };
}
