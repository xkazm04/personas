import { ChevronDown, ChevronRight, Activity } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTranslation } from '@/i18n/useTranslation';
import { useOperativeMemoryStore } from './operativeMemoryStore';

/**
 * D7 — Live ops view in the chat panel. Renders the operative-memory
 * digest (the same text Athena sees in her prompt every turn) inside
 * a collapsible strip above the chat transcript.
 *
 * Collapsed-by-default because most users won't have orchestration in
 * flight; expand on click. When collapsed, shows a one-line summary
 * ("3 ops in flight"); when expanded, shows the full digest in a
 * scrollable monospace block.
 *
 * Hides entirely when the digest is empty — no need to take vertical
 * space when there's nothing to show.
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

  if (!digest.trim()) return null;

  const opCount = countOps(digest);

  return (
    <div className="border-b border-border/40 bg-secondary/10">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 typo-label text-foreground/70 hover:bg-secondary/30 transition-colors"
      >
        {expanded ? (
          <ChevronDown className="size-3.5 shrink-0" />
        ) : (
          <ChevronRight className="size-3.5 shrink-0" />
        )}
        <Activity className="size-3.5 shrink-0 text-foreground/60" />
        <span className="truncate">
          {t.plugins.companion.orchestration.live_view_title}
        </span>
        <span className="ml-auto text-foreground/50 typo-caption shrink-0">
          {opCount === 1
            ? t.plugins.companion.orchestration.live_view_op_count_one
            : t.plugins.companion.orchestration.live_view_op_count_other.replace(
                '{count}',
                String(opCount),
              )}
        </span>
      </button>
      {expanded && (
        <pre className="max-h-[40vh] overflow-y-auto px-3 py-2 typo-caption text-foreground/80 whitespace-pre-wrap break-words font-mono leading-snug">
          {digest.trim()}
        </pre>
      )}
    </div>
  );
}

/**
 * Pull the operation count out of the digest header lines. The backend
 * format is `- **<intent>** (\`<op_id>\`, <status>, …)` — one line per
 * op. Counting `**` openers is more robust than parsing the whole
 * digest with a markdown lib.
 */
function countOps(digest: string): number {
  let count = 0;
  for (const line of digest.split('\n')) {
    if (line.startsWith('- **')) count += 1;
  }
  return count;
}
