import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, AlertCircle, FileText, Wrench, Coins, MessagesSquare } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { readTranscript } from '@/api/fleet/fleet';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';

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
  const [summary, setSummary] = useState<FleetTranscriptSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    if (!claudeSessionId) return;
    setLoading(true);
    setFailed(false);
    try {
      const s = await readTranscript(claudeSessionId);
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

  if (loading && !summary) {
    return <div className="h-full flex items-center justify-center"><LoadingSpinner label={f.insights_loading} /></div>;
  }

  if (failed && !summary) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-center p-6">
        <AlertCircle className="w-8 h-8 mb-2 text-amber-400" aria-hidden="true" />
        <p className="typo-caption text-foreground mb-3">{f.insights_error}</p>
        <Button variant="secondary" size="sm" icon={<RefreshCw className="w-3.5 h-3.5" />} onClick={load}>
          {t.common.refresh}
        </Button>
      </div>
    );
  }

  if (!summary) return null;

  const billable = Number(summary.tokens.input) + Number(summary.tokens.output);
  const spanMin = durationMinutes(summary.firstTimestamp, summary.lastTimestamp);

  return (
    <div className="h-full overflow-y-auto p-4 text-foreground" data-testid="fleet-insights">
      {/* Header + refresh (transcripts grow live). */}
      <div className="flex items-center gap-2 mb-3">
        <span className="typo-label uppercase tracking-wider">{f.insights_title}</span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto"
          onClick={load}
          aria-label={t.common.refresh}
          title={t.common.refresh}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

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
        <TokenCell label={f.insights_input} value={Number(summary.tokens.input)} />
        <TokenCell label={f.insights_output} value={Number(summary.tokens.output)} />
        <TokenCell label={f.insights_cache_read} value={Number(summary.tokens.cacheRead)} />
        <TokenCell label={f.insights_cache_write} value={Number(summary.tokens.cacheCreation)} />
      </div>

      {/* Tools used. */}
      <Section icon={<Wrench className="w-3.5 h-3.5" />} title={f.insights_tools}>
        {summary.tools.length === 0 ? (
          <p className="text-[11px] opacity-60">{f.insights_no_tools}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {summary.tools.map((tool) => (
              <span
                key={tool.name}
                className="inline-flex items-center gap-1 rounded-card border border-primary/15 bg-secondary/30 px-2 py-0.5 text-[11px]"
              >
                <span className="font-medium">{tool.name}</span>
                <span className="opacity-60">×{tool.count}</span>
              </span>
            ))}
          </div>
        )}
      </Section>

      {/* Files touched. */}
      <Section icon={<FileText className="w-3.5 h-3.5" />} title={tx(f.insights_files, { count: summary.filesTouched.length })}>
        {summary.filesTouched.length === 0 ? (
          <p className="text-[11px] opacity-60">{f.insights_no_files}</p>
        ) : (
          <div className="max-h-[180px] overflow-y-auto space-y-0.5">
            {summary.filesTouched.map((file) => (
              <p key={file} className="text-[11px] font-mono truncate" title={file}>{file}</p>
            ))}
          </div>
        )}
      </Section>

      {/* Footer: models + span. */}
      <div className="mt-3 pt-2 border-t border-primary/10 text-[10px] opacity-60 flex flex-wrap gap-x-3 gap-y-1">
        {summary.models.length > 0 && <span>{summary.models.join(', ')}</span>}
        {spanMin !== null && <span>{tx(f.insights_span, { minutes: spanMin })}</span>}
        {summary.parseErrors > 0 && (
          <span className="text-amber-400/80">{tx(f.insights_parse_errors, { count: summary.parseErrors })}</span>
        )}
      </div>
    </div>
  );
}

function Stat({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-primary/10 bg-secondary/20 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider opacity-60 mb-0.5">
        {icon}{label}
      </div>
      <div className="typo-card-label tabular-nums">{children}</div>
    </div>
  );
}

function TokenCell({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider opacity-60">{label}</div>
      <div className="text-[12px] font-medium tabular-nums"><Numeric value={value} unit="count" /></div>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-1.5 typo-label uppercase tracking-wider opacity-80">
        {icon}{title}
      </div>
      {children}
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
