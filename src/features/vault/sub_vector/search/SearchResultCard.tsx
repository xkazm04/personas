import { useState, useEffect, useRef } from 'react';
import { FileText, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import type { VectorSearchResult } from '@/api/vault/database/vectorKb';

interface SearchResultCardProps {
  result: VectorSearchResult;
  rank: number;
}

export function SearchResultCard({ result, rank }: SearchResultCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    return () => { if (copyTimerRef.current) clearTimeout(copyTimerRef.current); };
  }, []);

  const preview = result.content.length > 300 && !expanded
    ? result.content.slice(0, 300) + '...'
    : result.content;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(result.content);
    setCopied(true);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1200);
  };

  const scorePercent = Math.round(result.score * 100);

  return (
    <div className="rounded-xl border border-primary/10 bg-secondary/15 hover:bg-secondary/25 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-xs font-mono text-muted-foreground/40 w-5 text-right shrink-0">
          {rank}
        </span>
        <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0">
          <FileText className="w-3.5 h-3.5 text-violet-400/70" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground/90 truncate">{result.documentTitle}</p>
          {result.sourcePath && (
            <p className="text-xs text-muted-foreground/40 truncate mt-0.5 font-mono">{result.sourcePath}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ScoreBadge score={scorePercent} />
          <button
            onClick={() => void handleCopy()}
            className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground/40 hover:text-foreground/70 transition-colors"
            title="Copy content"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-3 pl-[52px]">
        <p className="text-xs text-foreground/70 whitespace-pre-wrap leading-relaxed font-mono">
          {preview}
        </p>

        {result.content.length > 300 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-violet-400/70 hover:text-violet-400 mt-2 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {expanded ? 'Show less' : 'Show full chunk'}
          </button>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground/40">
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
    <span className={`text-xs px-2 py-0.5 rounded-lg border font-mono ${colorClass}`}>
      {score}%
    </span>
  );
}
