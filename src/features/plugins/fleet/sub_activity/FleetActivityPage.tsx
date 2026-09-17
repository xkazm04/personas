import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, RefreshCw, Search, AlertCircle, Wrench, FileText } from 'lucide-react';
import { ContentBox, ContentHeader, ContentBody } from '@/features/shared/components/layout/ContentLayout';
import { ActionRow } from '@/features/shared/components/layout/ActionRow';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { recentTranscripts } from '@/api/fleet/fleet';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { useSystemStore } from '@/stores/systemStore';
import { BaseModal } from '@/lib/ui/BaseModal';
import { FleetSessionInsights } from '../sub_grid/FleetSessionInsights';
import { resolveActivityTarget } from './activityTarget';

/** Last path segment of a cwd (the project label), tolerant of \ and /. */
function projectLabel(cwd: string | null): string {
  if (!cwd) return 'unknown';
  const parts = cwd.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? cwd;
}

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
        <ActionRow>
          <Button variant="secondary" size="sm" icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />} onClick={load} disabled={loading}>
            {t.common.refresh}
          </Button>
        </ActionRow>

        <div className="relative my-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 w-3.5 h-3.5 -translate-y-1/2 text-foreground" aria-hidden="true" />
          <input
            type="text"
            data-testid="fleet-activity-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label={f.activity_search_placeholder}
            placeholder={f.activity_search_placeholder}
            className="w-full rounded-input border border-primary/10 bg-secondary/40 py-2 pl-9 pr-3 text-[14px] text-foreground placeholder:text-foreground/40 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
          />
        </div>

        {loading && rows.length === 0 ? (
          <div className="space-y-2" aria-busy="true" aria-label={f.activity_loading}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                aria-hidden
                className="rounded-card border border-primary/10 bg-card/30 h-16 animate-fade-in"
                style={{ animationDelay: '150ms' }}
              />
            ))}
          </div>
        ) : failed ? (
          <div className="text-center py-10">
            <AlertCircle className="w-7 h-7 text-amber-400 mx-auto mb-2" aria-hidden="true" />
            <p className="typo-caption text-foreground">{f.activity_error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 typo-caption text-foreground" data-testid="fleet-activity-empty">
            {rows.length === 0 ? f.activity_empty : f.activity_no_matches}
          </div>
        ) : (
          <div className="space-y-2" data-testid="fleet-activity-list">
            {filtered.map((r) => (
              <ActivityRow key={r.path} row={r} query={q} onOpen={openRow} />
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

function ActivityRow({ row, query, onOpen }: {
  row: FleetTranscriptSummary;
  query: string;
  onOpen: (row: FleetTranscriptSummary) => void;
}) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const tokens = Number(row.tokens.input) + Number(row.tokens.output);

  // When searching by file, surface the matching files; otherwise the first few.
  const matchedFiles = query
    ? row.filesTouched.filter((file) => file.toLowerCase().includes(query))
    : row.filesTouched;
  const shownFiles = matchedFiles.slice(0, 3);
  const extraFiles = matchedFiles.length - shownFiles.length;

  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      data-testid="fleet-activity-row"
      data-session-id={row.claudeSessionId}
      className="block w-full rounded-card border border-primary/10 bg-card/30 px-3 py-2 text-left transition-colors hover:border-primary/30 hover:bg-secondary/30"
    >
      <div className="flex items-center gap-2">
        <span className="typo-card-label truncate">{projectLabel(row.cwd)}</span>
        <span className="ml-auto text-[12px] text-foreground opacity-60">
          <RelativeTime timestamp={row.lastTimestamp} />
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[13px] text-foreground opacity-70 tabular-nums">
        <span><Numeric value={tokens} unit="count" /> {f.insights_tokens.toLowerCase()}</span>
        <span><Numeric value={row.assistantMessages} unit="count" /> {f.insights_turns.toLowerCase()}</span>
        {row.models.length > 0 && <span className="text-foreground opacity-50">{row.models[0]}</span>}
      </div>

      {row.tools.length > 0 && (
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          <Wrench className="w-3 h-3 text-foreground opacity-50" aria-hidden="true" />
          {row.tools.slice(0, 6).map((tool) => (
            <span key={tool.name} className="inline-flex items-center gap-1 rounded-card border border-primary/10 bg-secondary/30 px-1.5 py-0.5 text-[12px]">
              {tool.name}<span className="opacity-60">×{tool.count}</span>
            </span>
          ))}
        </div>
      )}

      {shownFiles.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 mt-1.5 text-[12px] font-mono text-foreground opacity-60">
          <FileText className="w-3 h-3 text-foreground opacity-50" aria-hidden="true" />
          {shownFiles.map((file) => (
            <span key={file} className="truncate max-w-[220px]" title={file}>{file}</span>
          ))}
          {extraFiles > 0 && <span className="text-foreground opacity-40">{tx(f.activity_files_more, { count: extraFiles })}</span>}
        </div>
      )}
    </button>
  );
}
