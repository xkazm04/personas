import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, AlertCircle } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { Button } from '@/features/shared/components/buttons';
import { recentTranscripts } from '@/api/fleet/fleet';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { BaseModal } from '@/lib/ui/BaseModal';
import { FleetSessionInsights } from '../sub_grid/FleetSessionInsights';
import { FleetSearchField } from '../sub_grid/FleetSearchField';
import { resolveActivityTarget, projectLabel } from './activityTarget';
import { FleetActivityRow } from './FleetActivityRow';

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
        {/* Filter and refresh share one row: the Refresh button stood alone on a band of its own. */}
        <div className="flex items-center gap-2 mb-3">
          <FleetSearchField
            className="flex-1"
            data-testid="fleet-activity-search"
            value={query}
            onChange={setQuery}
            placeholder={f.activity_search_placeholder}
          />
          <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load} loading={loading}>
            {t.common.refresh}
          </Button>
        </div>

        {loading && rows.length === 0 ? (
          <div className="space-y-2" aria-busy="true" aria-label={f.activity_loading}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                className="rounded-card border border-primary/10 bg-card/30 h-[100px] 2xl:h-[72px] animate-fade-in"
                style={{ animationDelay: '150ms' }}
              />
            ))}
          </div>
        ) : failed ? (
          <div className="text-center py-10">
            <AlertCircle className="w-7 h-7 text-status-warning mx-auto mb-2" aria-hidden="true" />
            <p className="typo-caption text-foreground">{f.activity_error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 typo-caption text-foreground" data-testid="fleet-activity-empty">
            {rows.length === 0 ? f.activity_empty : f.activity_no_matches}
          </div>
        ) : (
          <div className="space-y-2" data-testid="fleet-activity-list">
            {filtered.map((r) => (
              <FleetActivityRow key={r.path} row={r} query={q} onOpen={openRow} />
            ))}
          </div>
        )}
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
