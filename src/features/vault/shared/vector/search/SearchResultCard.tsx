import { useState } from 'react';
import { FileText, ChevronDown, ChevronUp, ScanLine } from 'lucide-react';
import { CopyButton } from '@/features/shared/components/buttons';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { VectorSearchResult } from '@/api/vault/database/vectorKb';
import { isPartialExtraction } from '../partialConfidence';
import Button from '@/features/shared/components/buttons/Button';

interface SearchResultCardProps {
  result: VectorSearchResult;
  rank: number;
}

export function SearchResultCard({ result, rank }: SearchResultCardProps) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;
  const [expanded, setExpanded] = useState(false);
  const isPartial = isPartialExtraction(result.extractionConfidence);

  const preview = result.content.length > 300 && !expanded
    ? result.content.slice(0, 300) + '...'
    : result.content;

  const scorePercent = Math.round(result.score * 100);

  return (
    <div className="rounded-modal border border-hair bg-secondary/15 hover:bg-surface-1 transition-colors">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="typo-code text-foreground w-5 text-right shrink-0">
          {rank}
        </span>
        <div className="w-7 h-7 rounded-card bg-role-agent/10 border border-role-agent/15 flex items-center justify-center shrink-0">
          <FileText className="w-3.5 h-3.5 text-role-agent/70" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="typo-body text-ink-1 truncate">{result.documentTitle}</p>
          {result.sourcePath && (
            <p className="typo-code text-foreground truncate mt-0.5">{result.sourcePath}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isPartial && (
            <Tooltip content={sh.partial_text_tooltip}>
              <span className="inline-flex items-center gap-1 typo-code px-2 py-0.5 text-status-warning/80">
                <ScanLine className="w-3 h-3" aria-hidden />
                {sh.partial_text_badge}
              </span>
            </Tooltip>
          )}
          <ScoreBadge score={scorePercent} />
          <CopyButton text={result.content} tooltip={t.common.copy} />
        </div>
      </div>

      {/* Content */}
      <div className="px-4 pb-3 pl-[52px]">
        <p className="typo-code text-foreground whitespace-pre-wrap">
          {preview}
        </p>

        {result.content.length > 300 && (
          <Button
            type="button"
            onClick={() => setExpanded(!expanded)}
            variant="ghost"
            size="sm"
            className="mt-2"
            icon={expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          >
            {expanded ? sh.show_less : sh.show_full_chunk}
          </Button>
        )}

        {/* Metadata */}
        <div className="flex items-center gap-3 mt-2 typo-caption text-foreground">
          {result.sourcePage != null && (
            <span className="text-primary/80">{tx(sh.page_label, { page: result.sourcePage })}</span>
          )}
          <span>{sh.distance_label} <Numeric value={result.distance} precision={4} /></span>
          <span>{sh.chunk_label} {result.chunkId.slice(0, 8)}</span>
        </div>
      </div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  let colorClass = 'bg-role-agent/10 text-role-agent/80 border-role-agent/15';
  if (score >= 80) colorClass = 'bg-status-success/10 text-status-success/80 border-status-success/15';
  else if (score >= 60) colorClass = 'bg-status-warning/10 text-status-warning/80 border-status-warning/15';

  return (
    <span className={`typo-code px-2 py-0.5 rounded-card border ${colorClass}`}>
      {score}%
    </span>
  );
}
