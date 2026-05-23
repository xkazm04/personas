import { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FileText,
  Flag,
  Wrench,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useOperativeMemoryStore } from './operativeMemoryStore';
import { parseDigest, type ParsedOp, type ParsedSession } from './parseDigest';

/**
 * D7 — Live ops view in the chat panel. Renders the operative-memory
 * digest (the same text Athena sees in her prompt every turn) as a
 * collapsible strip above the chat transcript.
 *
 * Top-level: collapsed by default with a one-line summary ("3 ops"); click
 * the header to expand. When expanded, each operation parses into its own
 * card with a status badge, intent, duration, and a click-to-expand
 * sessions list (state · tool · intent · checkpoint · files · failure ·
 * summary). Per-op state lives in `expandedOps` keyed by op id8, so each
 * row remembers its toggle independently.
 *
 * Defensive: if the parser produces zero ops but the digest is non-empty
 * (backend format drift), fall back to the raw monospace block so power
 * users still see what Athena sees.
 */
export function LiveOpsStrip() {
  const { t } = useTranslation();
  const { digest, expanded, setExpanded } = useOperativeMemoryStore(
    useShallow((s) => ({
      digest: s.digest,
      expanded: s.expanded,
      setExpanded: s.setExpanded,
    })),
  );
  const [expandedOps, setExpandedOps] = useState<Record<string, boolean>>({});

  const parsed = useMemo(() => parseDigest(digest), [digest]);

  if (!digest.trim()) return null;

  const opCount = parsed.length || countOps(digest);

  const toggleOp = (id8: string) => {
    setExpandedOps((s) => ({ ...s, [id8]: !s[id8] }));
  };

  return (
    <div className="border-b border-border/40 bg-secondary/10">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 typo-label text-foreground hover:bg-secondary/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
        <Activity className="size-3.5 shrink-0 text-foreground" />
        <span className="truncate">
          {t.plugins.companion.orchestration.live_view_title}
        </span>
        <span className="ml-auto text-foreground typo-caption shrink-0">
          {opCount === 1
            ? t.plugins.companion.orchestration.live_view_op_count_one
            : t.plugins.companion.orchestration.live_view_op_count_other.replace(
                '{count}',
                String(opCount),
              )}
        </span>
      </button>
      {expanded && (
        <div className="max-h-[40vh] overflow-y-auto px-3 py-2 space-y-1.5">
          {parsed.length > 0 ? (
            parsed.map((op) => (
              <OpCard
                key={op.id8}
                op={op}
                expanded={!!expandedOps[op.id8]}
                onToggle={() => toggleOp(op.id8)}
              />
            ))
          ) : (
            <pre className="typo-caption text-foreground whitespace-pre-wrap break-words font-mono leading-snug">
              {digest.trim()}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function OpCard({
  op,
  expanded,
  onToggle,
}: {
  op: ParsedOp;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const statusTone = toneForStatus(op.status);
  return (
    <div className="rounded-card border border-foreground/10 bg-foreground/[0.02]">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-1.5 px-2 py-1.5 typo-caption text-foreground hover:bg-foreground/[0.04] transition-colors rounded-interactive text-left"
        aria-expanded={expanded}
        data-testid="companion-live-ops-op"
        data-op-id={op.id8}
      >
        <Chevron className="size-3 shrink-0 mt-0.5" />
        <span
          className={`shrink-0 rounded-interactive px-1.5 py-0 typo-caption ${statusTone}`}
          title={op.status}
        >
          {op.status}
        </span>
        <div className="flex-1 min-w-0">
          <div className="truncate text-foreground/90">{op.intent}</div>
          <div className="flex items-baseline gap-1.5 text-foreground typo-caption">
            <code className="font-mono">{op.id8}</code>
            <span>·</span>
            <span>{op.duration}</span>
            <span>·</span>
            <span>
              {op.sessions.length === 1
                ? t.plugins.companion.orchestration.live_view_session_count_one
                : t.plugins.companion.orchestration.live_view_session_count_other.replace(
                    '{count}',
                    String(op.sessions.length),
                  )}
            </span>
          </div>
        </div>
      </button>
      {expanded && op.sessions.length > 0 && (
        <ol className="space-y-1.5 px-2 pb-2 pl-7">
          {op.sessions.map((sess) => (
            <SessionRow key={sess.id8} sess={sess} />
          ))}
        </ol>
      )}
    </div>
  );
}

function SessionRow({ sess }: { sess: ParsedSession }) {
  const { t } = useTranslation();
  return (
    <li
      className="space-y-0.5 typo-caption text-foreground/85"
      data-testid="companion-live-ops-session"
      data-session-id={sess.id8}
    >
      <div className="flex items-baseline gap-1.5">
        <code className="font-mono text-foreground">{sess.id8}</code>
        {sess.role && (
          <span className="text-foreground italic">{sess.role}</span>
        )}
        <span className="text-foreground">·</span>
        <span>{sess.state}</span>
        {sess.tool && (
          <span className="inline-flex items-center gap-1 text-foreground">
            <Wrench className="size-3" />
            <code className="font-mono">{sess.tool}</code>
          </span>
        )}
      </div>
      {sess.intent && (
        <DetailLine
          label={t.plugins.companion.orchestration.live_view_intent_label}
          text={sess.intent}
          icon={<Flag className="size-3 text-foreground" />}
        />
      )}
      {sess.checkpoint && (
        <DetailLine
          label={t.plugins.companion.orchestration.live_view_checkpoint_label}
          text={sess.checkpoint}
        />
      )}
      {sess.blockers && (
        <DetailLine
          label={t.plugins.companion.orchestration.live_view_blockers_label}
          text={sess.blockers}
          tone="warn"
        />
      )}
      {sess.files && sess.files.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-1">
          <span className="inline-flex items-baseline gap-1 text-foreground">
            <FileText className="size-3 self-center" />
            <span>{t.plugins.companion.orchestration.live_view_files_label}:</span>
          </span>
          {sess.files.map((f) => (
            <code
              key={f}
              className="font-mono rounded-interactive bg-foreground/[0.05] border border-foreground/10 px-1 py-0 text-foreground"
            >
              {f}
            </code>
          ))}
          {sess.filesMore !== undefined && sess.filesMore > 0 && (
            <span className="text-foreground italic">
              {t.plugins.companion.orchestration.live_view_files_more.replace(
                '{count}',
                String(sess.filesMore),
              )}
            </span>
          )}
        </div>
      )}
      {sess.failure && (
        <DetailLine
          label={t.plugins.companion.orchestration.live_view_failure_label}
          text={sess.failure}
          tone="error"
          icon={<AlertTriangle className="size-3 text-rose-400" />}
        />
      )}
      {sess.summary && (
        <DetailLine
          label={t.plugins.companion.orchestration.live_view_summary_label}
          text={sess.summary}
        />
      )}
    </li>
  );
}

function DetailLine({
  label,
  text,
  tone,
  icon,
}: {
  label: string;
  text: string;
  tone?: 'warn' | 'error';
  icon?: React.ReactNode;
}) {
  const toneClass =
    tone === 'error'
      ? 'text-rose-400'
      : tone === 'warn'
        ? 'text-amber-400'
        : 'text-foreground/85';
  return (
    <div className={`flex items-baseline gap-1 ${toneClass}`}>
      {icon ?? null}
      <span className="text-foreground shrink-0">{label}:</span>
      <span className="break-words">{text}</span>
    </div>
  );
}

function toneForStatus(status: string): string {
  const norm = status.toLowerCase();
  if (norm.includes('fail') || norm.includes('error')) {
    return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
  }
  if (norm.includes('complete') || norm.includes('finished')) {
    return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
  }
  if (norm.includes('block') || norm.includes('wait')) {
    return 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
  }
  // Active / running / dispatched / queued — neutral primary tint.
  return 'bg-primary/10 text-primary border border-primary/20';
}

/**
 * Fallback counter for the rare case where parsing yields zero ops but
 * the digest is non-empty (format drift). Uses the same `**` opener
 * heuristic the old strip relied on, so the header count stays honest
 * even under the raw `<pre>` rendering path.
 */
function countOps(digest: string): number {
  let count = 0;
  for (const line of digest.split('\n')) {
    if (line.startsWith('- **')) count += 1;
  }
  return count;
}
