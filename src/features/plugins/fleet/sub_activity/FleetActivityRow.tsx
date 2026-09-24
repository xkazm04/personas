import { Wrench, FileText } from 'lucide-react';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';
import { useTranslation } from '@/i18n/useTranslation';
import { projectLabel } from './activityTarget';

/** Last path segment: the part of a touched file that tells two files apart. */
function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * One recent session in the Activity feed, on a fixed rhythm: the project,
 * model and figures on the first line, then a tools line and a files line
 * that are always drawn (empty when the run used none), so every row is the
 * same height. From 2xl the tools and files share the second line.
 *
 * Files show their name, not their path: three paths cut at 220px all read
 * "src/features/plugins/flee..." and told the rows nothing. The full path is
 * in the tooltip, and a search still matches against it.
 */
export function FleetActivityRow({ row, query, onOpen }: {
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
      <div className="flex items-baseline gap-3 min-w-0">
        <span className="typo-card-label truncate">{projectLabel(row.cwd)}</span>
        {row.models.length > 0 && <span className="typo-caption truncate">{row.models[0]}</span>}
        <span className="ml-auto flex shrink-0 items-baseline gap-3 typo-data text-foreground">
          <span><Numeric value={tokens} unit="count" /> {f.insights_tokens.toLowerCase()}</span>
          <span><Numeric value={row.assistantMessages} unit="count" /> {f.insights_turns.toLowerCase()}</span>
          <span className="typo-caption w-24 text-right"><RelativeTime timestamp={row.lastTimestamp} /></span>
        </span>
      </div>

      <div className="mt-1 grid grid-cols-1 2xl:grid-cols-2 gap-x-6 gap-y-1">
        <div className="flex h-6 items-center gap-1 min-w-0 overflow-hidden">
          {row.tools.length > 0 && <Wrench className="w-3.5 h-3.5 shrink-0 text-foreground" aria-hidden="true" />}
          {row.tools.slice(0, 6).map((tool) => (
            <span key={tool.name} className="inline-flex shrink-0 items-center gap-1 rounded-interactive border border-primary/10 bg-secondary/30 px-1.5 typo-label text-foreground">
              {tool.name}<span className="typo-caption">×{tool.count}</span>
            </span>
          ))}
        </div>
        <div className="flex h-6 items-center gap-x-3 min-w-0 overflow-hidden">
          {shownFiles.length > 0 && <FileText className="w-3.5 h-3.5 shrink-0 text-foreground" aria-hidden="true" />}
          {shownFiles.map((file) => (
            <Tooltip key={file} content={file}>
              <span className="typo-code text-foreground truncate">{baseName(file)}</span>
            </Tooltip>
          ))}
          {extraFiles > 0 && <span className="typo-caption shrink-0">{tx(f.activity_files_more, { count: extraFiles })}</span>}
        </div>
      </div>
    </button>
  );
}
