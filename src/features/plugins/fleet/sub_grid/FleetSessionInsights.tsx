import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertCircle, FileText, Wrench, Coins, MessagesSquare } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { sessionMetadata, readTranscript } from '@/api/fleet/fleet';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import { readSummaryCache, writeSummaryCache, SUMMARY_TTL_MS } from './insightsCache';
import { Stat, TokenCell, Section } from './InsightsParts';

interface Props {
  /** Bound Claude session id; null while the session is still Spawning. */
  claudeSessionId: string | null;
}

/**
 * Per-session transcript intelligence (F2 / P2.1). Reads the session's JSONL
 * transcript via `fleet_read_transcript` (P0) and renders a glanceable rollup:
 * tokens, turns, tools used, and files touched. Works for exited sessions too
 * (the transcript outlives the PTY), so it doubles as a "what did this run do"
 * review surface.
 */
export function FleetSessionInsights({ claudeSessionId }: Props) {
  const { t, tx } = useTranslation();
  const f = t.plugins.fleet;
  const [summary, setSummary] = useState<FleetTranscriptSummary | null>(
    () => (claudeSessionId ? readSummaryCache(claudeSessionId)?.summary ?? null : null),
  );
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (force = false) => {
    if (!claudeSessionId) return;
    const cached = readSummaryCache(claudeSessionId);
    if (!force && cached && Date.now() - cached.at < SUMMARY_TTL_MS) {
      setSummary(cached.summary);
      setFailed(false);
      return;
    }
    if (!cached) setSummary(null);
    setLoading(true);
    setFailed(false);
    try {
      // Prefer the incremental rollup (delta-only, scale-friendly); fall back
      // to a full transcript read if the rollup isn't available yet.
      const s = (await sessionMetadata(claudeSessionId)) ?? (await readTranscript(claudeSessionId));
      writeSummaryCache(claudeSessionId, { summary: s, at: Date.now() });
      setSummary(s);
    } catch (e) {
      setFailed(true);
      setSummary(null);
      silentCatch('FleetSessionInsights:readTranscript')(e);
    } finally {
      setLoading(false);
    }
  }, [claudeSessionId]);

  useEffect(() => { load(); }, [load]);

  if (!claudeSessionId) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6 text-foreground">
        <Coins className="w-8 h-8 mb-2 opacity-60" aria-hidden="true" />
        <p className="typo-caption">{f.insights_no_transcript}</p>
      </div>
    );
  }

  const billable = summary ? Number(summary.tokens.input) + Number(summary.tokens.output) : 0;
  const spanMin = summary ? durationMinutes(summary.firstTimestamp, summary.lastTimestamp) : null;

  return (
    <div className="h-full overflow-y-auto p-4 text-foreground" data-testid={summary ? 'fleet-insights' : undefined}>
      {/* Header + refresh (transcripts grow live). Chrome stays up on cold load. */}
      <div className="flex items-center gap-2 mb-3">
        <span className="typo-heading">{f.insights_title}</span>
        <Tooltip content={t.common.refresh}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            onClick={() => load(true)}
            loading={loading}
            aria-label={t.common.refresh}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
        </Tooltip>
      </div>

      {failed && !summary ? (
        <div className="flex flex-col items-center justify-center text-center py-8">
          <AlertCircle className="w-8 h-8 mb-2 text-status-warning" aria-hidden="true" />
          <p className="typo-caption mb-3">{f.insights_error}</p>
          <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={() => load(true)}>
            {t.common.refresh}
          </Button>
        </div>
      ) : !summary ? (
        <div className="grid grid-cols-3 gap-2 mb-3" aria-busy="true" aria-label={f.insights_loading}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              aria-hidden
              className="rounded-card border border-primary/10 bg-secondary/20 h-14 animate-fade-in"
              style={{ animationDelay: '150ms' }}
            />
          ))}
        </div>
      ) : null}

      {!summary ? null : (
        <>

      {/* Headline stat cards. */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <Stat icon={<Coins className="w-3.5 h-3.5" />} label={f.insights_tokens}>
          <Numeric value={billable} unit="count" />
        </Stat>
        <Stat icon={<MessagesSquare className="w-3.5 h-3.5" />} label={f.insights_turns}>
          <Numeric value={summary.assistantMessages} unit="count" />
        </Stat>
        <Stat icon={<MessagesSquare className="w-3.5 h-3.5" />} label={f.insights_prompts}>
          <Numeric value={summary.userMessages} unit="count" />
        </Stat>
      </div>

      {/* Token breakdown. */}
      <div className="grid grid-cols-4 gap-2 mb-4 text-center">
        <TokenCell label={f.insights_input}><Numeric value={Number(summary.tokens.input)} unit="count" /></TokenCell>
        <TokenCell label={f.insights_output}><Numeric value={Number(summary.tokens.output)} unit="count" /></TokenCell>
        <TokenCell label={f.insights_cache_read}><Numeric value={Number(summary.tokens.cacheRead)} unit="count" /></TokenCell>
        <TokenCell label={f.insights_cache_write}><Numeric value={Number(summary.tokens.cacheCreation)} unit="count" /></TokenCell>
      </div>

      {/* Tools used. */}
      <Section icon={<Wrench className="w-3.5 h-3.5" />} title={f.insights_tools}>
        {summary.tools.length === 0 ? (
          <p className="typo-caption">{f.insights_no_tools}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {summary.tools.map((tool) => (
              <span
                key={tool.name}
                className="inline-flex items-center gap-1 rounded-card border border-primary/15 bg-secondary/30 px-2 py-0.5 typo-body text-foreground"
              >
                <span>{tool.name}</span>
                <span className="typo-caption">×{tool.count}</span>
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Files touched. */}
      <Section icon={<FileText className="w-3.5 h-3.5" />} title={tx(f.insights_files, { count: summary.filesTouched.length })}>
        {summary.filesTouched.length === 0 ? (
          <p className="typo-caption">{f.insights_no_files}</p>
        ) : (
          <div className="max-h-[180px] overflow-y-auto space-y-0.5">
            {summary.filesTouched.map((file) => (
              <Tooltip key={file} content={file}>
                <p className="typo-code truncate">{file}</p>
              </Tooltip>
            ))}
          </div>
        )}
      </Section>

      {/* Footer: models + span. */}
      <div className="mt-3 pt-2 border-t border-primary/10 typo-caption flex flex-wrap gap-x-3 gap-y-1">
        {summary.models.length > 0 && <span>{summary.models.join(', ')}</span>}
        {spanMin !== null && <span>{tx(f.insights_span, { minutes: spanMin })}</span>}
        {summary.parseErrors > 0 && (
          <span className="text-status-warning">{tx(f.insights_parse_errors, { count: summary.parseErrors })}</span>
        )}
      </div>
        </>
      )}
    </div>
  );
}

/** Whole minutes between two ISO timestamps, or null if either is missing. */
function durationMinutes(first: string | null, last: string | null): number | null {
  if (!first || !last) return null;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 60000);
}
