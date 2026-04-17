import { useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { CopyButton } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import type { VectorSearchResult } from '@/api/vault/database/vectorKb';

interface SearchResultCardProps {
  result: VectorSearchResult;
  rank: number;
}

export function SearchResultCard({ result, rank }: SearchResultCardProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [expanded, setExpanded] = useState(false);

  const preview = result.content.length > 300 && !expanded
    ? result.content.slice(0, 300) + '...'
    : result.content;

  const scorePercent = Math.round(result.score * 100);

  return (
    <div className="rounded-modal border border-primary/10 bg-secondary/15 hover:bg-secondary/25 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-xs font-mono text-foreground w-5 text-right shrink-0">
          {rank}
        </span>
        <div className="w-7 h-7 rounded-card bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0">
          <FileText className="w-3.5 h-3.5 text-violet-400/70" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/90 truncate">{result.documentTitle}</p>
          {result.sourcePath && (
            <p className="text-xs text-foreground truncate mt-0.5 font-mono">{result.sourcePath}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ScoreBadge score={scorePercent} />
          <CopyButton text={result.content} tooltip="Copy content" />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-3 pl-[52px]">
        <p className="text-xs text-foreground whitespace-pre-wrap leading-relaxed font-mono">
          {preview}
        </p>

        {result.content.length > 300 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-violet-400/70 hover:text-violet-400 mt-2 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? sh.show_less : sh.show_full_chunk}
          </button>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-3 mt-2 text-xs text-foreground">
          <span>distance: {result.distance.toFixed(4)}</span>
          <span>chunk: {result.chunkId.slice(0, 8)}</span>
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  let colorClass = 'bg-violet-500/10 text-violet-400/80 border-violet-500/15';
  if (score >= 80) colorClass = 'bg-emerald-500/10 text-emerald-400/80 border-emerald-500/15';
  else if (score >= 60) colorClass = 'bg-amber-500/10 text-amber-400/80 border-amber-500/15';

  return (
    <span className={`text-xs px-2 py-0.5 rounded-card border font-mono ${colorClass}`}>
      {score}%
    </span>
  );
}
