import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { recentTranscripts } from '@/api/fleet/fleet';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { BaseModal } from '@/lib/ui/BaseModal';
import { FleetSessionInsights } from '../sub_grid/FleetSessionInsights';
import { resolveActivityTarget, projectLabel } from './activityTarget';
import { FleetActivitySurface } from './FleetActivitySurface';

/**
 * Cross-session activity feed (F2 / P2.2). Lists the most recently-active
 * Claude Code sessions across all projects (via `fleet_recent_transcripts`)
 * and lets you search across project / files-touched / tools / models —
 * e.g. "which sessions touched auth.rs?".
 *
 * A SEARCH HIT IS A DOOR. The rows were inert cards, so the tab answered its
 * own question with a report and left the operator to find the session by
 * hand. A row's `claudeSessionId` is exactly the key the live registry binds
 * by, so a click goes to the registry's session when it has one and to the
 * transcript's own rollup when it does not — a finished run stays readable
 * rather than becoming a dead row.
 *
 * The body is composed from the composition kit (FleetActivitySurface): a row
 * click selects and shows the detail, Enter or the detail's action is the door.
 */
export default function FleetActivityPage({ onOpenSessions }: {
  /** Switch the Fleet plugin to its Sessions tab. Absent = stay put. */
  onOpenSessions?: () => void;
} = {}) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const [rows, setRows] = useState<FleetTranscriptSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const sessions = useSystemStore((st) => st.fleetSessions);
  const setActiveSession = useSystemStore((st) => st.fleetSetActiveSession);
  const [insights, setInsights] = useState<string | null>(null);
  const liveSessionIds = useMemo(
    () => new Set(sessions.map((s) => s.claudeSessionId).filter((id): id is string => !!id)),
    [sessions],
  );

  const openRow = useCallback((r: FleetTranscriptSummary) => {
    const target = resolveActivityTarget(r, sessions);
    if (target.kind === 'session') {
      setActiveSession(target.sessionId);
      onOpenSessions?.();
      return;
    }
    setInsights(target.claudeSessionId);
  }, [sessions, setActiveSession, onOpenSessions]);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      setRows(await recentTranscripts());
    } catch (e) {
      setFailed(true);
      silentCatch('FleetActivityPage:recentTranscripts')(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return rows;
    return rows.filter((r) =>
      projectLabel(r.cwd).toLowerCase().includes(q) ||
      r.filesTouched.some((file) => file.toLowerCase().includes(q)) ||
      r.tools.some((tool) => tool.name.toLowerCase().includes(q)) ||
      r.models.some((m) => m.toLowerCase().includes(q)),
    );
  }, [rows, q]);

  return (
    <ContentBox>
      <ContentHeader
        icon={<Activity className="w-5 h-5 text-primary" />}
        title={f.activity_title}
        subtitle={tx(rows.length === 1 ? f.activity_subtitle_one : f.activity_subtitle_other, { count: rows.length })}
      />
      <ContentBody>
        <FleetActivitySurface
          rows={rows}
          filtered={filtered}
          loading={loading}
          failed={failed}
          query={query}
          setQuery={setQuery}
          onRefresh={load}
          onOpen={openRow}
          liveSessionIds={liveSessionIds}
        />
      </ContentBody>

      <BaseModal
        isOpen={insights !== null}
        onClose={() => setInsights(null)}
        titleId="fleet-activity-insights-title"
        size="lg"
        portal
      >
        <h2 id="fleet-activity-insights-title" className="typo-section-title mb-3">
          {f.insights_title}
        </h2>
        {insights !== null && <FleetSessionInsights claudeSessionId={insights} />}
      </BaseModal>
    </ContentBox>
  );
}
