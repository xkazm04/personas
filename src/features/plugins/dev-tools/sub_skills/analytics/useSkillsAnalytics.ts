// Skills Analytics data spine — the unified "skill run" log + per-skill
// performance inputs.
//
// A skill run has two sources:
//  (a) Fleet sessions whose first arg is a `/skill …` slash command — every
//      skills dispatch (Use dialog, coverage pipeline, workbench) spawns one.
//      Status comes from the session state; tokens/duration from the cheap
//      per-session transcript rollup (`sessionMetadata`).
//  (b) Legacy dev_scans rows — the Idea Scanner's history, kept so the log
//      isn't empty on day one and past agent runs stay comparable.
import { useEffect, useMemo, useState } from 'react';

import { listScans, type DevScan } from '@/api/devTools/devTools';
import { listSessions, sessionMetadata } from '@/api/fleet/fleet';
import type { FleetSession } from '@/lib/bindings/FleetSession';
import { silentCatch } from '@/lib/silentCatch';

export interface SkillRunRow {
  id: string;
  kind: 'fleet' | 'scan';
  /** Skill name for fleet runs; comma-joined agent keys for legacy scans. */
  skill: string;
  /** Trailing args after the slash command (fleet) — often the context name. */
  args: string;
  /** Fleet session state token or legacy scan status. */
  status: string;
  statusReason: string | null;
  /** ms epoch. */
  startedAt: number;
  /** ms epoch of last activity (fleet) — duration = last - started. */
  endedAt: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Legacy scans: ideas produced. */
  ideaCount: number | null;
  projectLabel: string | null;
}

/** Parse `/skill-name rest of args` out of a session's first CLI arg. */
export function parseSkillArg(args: string[]): { skill: string; rest: string } | null {
  const first = args[0];
  if (!first || !first.startsWith('/')) return null;
  const space = first.indexOf(' ');
  const skill = (space === -1 ? first.slice(1) : first.slice(1, space)).trim();
  if (!skill) return null;
  return { skill, rest: space === -1 ? '' : first.slice(space + 1).trim() };
}

function fleetRun(s: FleetSession, parsed: { skill: string; rest: string }): SkillRunRow {
  const created = Number(s.createdAtMs);
  const last = Number(s.lastActivityMs);
  const live = s.state === 'spawning' || s.state === 'running' || s.state === 'awaiting_input';
  return {
    id: s.id,
    kind: 'fleet',
    skill: parsed.skill,
    args: parsed.rest,
    status: String(s.state),
    statusReason: s.stateReason,
    startedAt: created,
    endedAt: live ? null : (last > created ? last : null),
    inputTokens: null,
    outputTokens: null,
    ideaCount: null,
    projectLabel: s.projectLabel,
  };
}

function scanRun(s: DevScan): SkillRunRow {
  return {
    id: s.id,
    kind: 'scan',
    skill: s.scan_type,
    args: '',
    status: s.status,
    statusReason: s.error ?? null,
    startedAt: new Date(s.created_at).getTime(),
    endedAt: s.duration_ms == null ? null : new Date(s.created_at).getTime() + Number(s.duration_ms),
    inputTokens: s.input_tokens == null ? null : Number(s.input_tokens),
    outputTokens: s.output_tokens == null ? null : Number(s.output_tokens),
    ideaCount: s.idea_count,
    projectLabel: null,
  };
}

/** How many fleet rows get a transcript-token lookup (cheap delta reads). */
const TOKEN_LOOKUPS = 30;

export function useSkillsAnalytics(projectId: string | null, refreshTick = 0): {
  runs: SkillRunRow[];
  loading: boolean;
} {
  const [fleetRows, setFleetRows] = useState<SkillRunRow[]>([]);
  const [scanRows, setScanRows] = useState<SkillRunRow[]>([]);
  const [tokensBySession, setTokensBySession] = useState<Map<string, { input: number; output: number }>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listSessions()
      .then(async (snap) => {
        if (!alive) return;
        const skillSessions = snap.sessions
          .map((s) => ({ s, parsed: parseSkillArg(s.args) }))
          .filter((x): x is { s: FleetSession; parsed: { skill: string; rest: string } } => x.parsed !== null);
        setFleetRows(skillSessions.map(({ s, parsed }) => fleetRun(s, parsed)));

        // Token rollups for the most recent runs — bounded, cheap delta path.
        const bound = skillSessions
          .filter(({ s }) => s.claudeSessionId)
          .sort((a, b) => Number(b.s.createdAtMs) - Number(a.s.createdAtMs))
          .slice(0, TOKEN_LOOKUPS);
        const entries = await Promise.all(bound.map(async ({ s }) => {
          try {
            const meta = await sessionMetadata(s.claudeSessionId as string);
            if (!meta) return null;
            return [s.id, {
              input: Number(meta.tokens.input),
              output: Number(meta.tokens.output),
            }] as const;
          } catch { return null; }
        }));
        if (alive) setTokensBySession(new Map(entries.filter((e): e is NonNullable<typeof e> => e !== null)));
      })
      .catch(silentCatch('skillsAnalytics fleet sessions'))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [refreshTick]);

  useEffect(() => {
    if (!projectId) { setScanRows([]); return; }
    let alive = true;
    listScans(projectId, 50)
      .then((rows) => { if (alive) setScanRows(rows.map(scanRun)); })
      .catch(silentCatch('skillsAnalytics scans'));
    return () => { alive = false; };
  }, [projectId, refreshTick]);

  const runs = useMemo(() => {
    const withTokens = fleetRows.map((r) => {
      const tok = tokensBySession.get(r.id);
      return tok ? { ...r, inputTokens: tok.input, outputTokens: tok.output } : r;
    });
    return [...withTokens, ...scanRows].sort((a, b) => b.startedAt - a.startedAt);
  }, [fleetRows, scanRows, tokensBySession]);

  return { runs, loading };
}
