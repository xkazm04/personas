import { useState, useCallback } from 'react';
import { Map, ChevronRight, AlertCircle } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Collapse } from '@/features/shared/components/display/Collapse';
import { MarkdownRenderer } from '@/features/shared/components/editors/MarkdownRenderer';
import { kbCorpusMap } from '@/api/vault/database/vectorKb';
import { createLogger } from '@/lib/log';

const logger = createLogger('vector-kb-corpus-overview');

interface CorpusOverviewProps {
  kbId: string;
}

/**
 * Collapsible Markdown overview of a knowledge base's corpus — the same map the
 * twin retrieval context prepends when a KB is bound (`kb_corpus_map`). The map
 * is fetched lazily on first expand so an unopened panel costs nothing.
 */
export function CorpusOverview({ kbId }: CorpusOverviewProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [map, setMap] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      setMap(await kbCorpusMap(kbId));
    } catch (err) {
      setError(true);
      logger.error('Corpus map load failed', { error: String(err) });
    } finally {
      setLoading(false);
    }
  }, [kbId]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (next && map === null && !loading) void load();
      return next;
    });
  }, [map, loading, load]);

  return (
    <div className="mx-4 mt-3 rounded-card border border-primary/10 bg-secondary/20" data-testid="kb-corpus-overview">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center gap-2 px-3 py-2 typo-body text-foreground focus-ring rounded-card transition-colors"
      >
        <ChevronRight className={`w-3.5 h-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        <Map className="w-4 h-4 shrink-0 text-violet-400/70" aria-hidden />
        <span className="font-medium">{t.vault.shared.corpus_overview_title}</span>
        <span className="typo-caption text-foreground truncate hidden sm:inline">
          {t.vault.shared.corpus_overview_subtitle}
        </span>
      </button>

      <Collapse open={open}>
        <div className="px-4 pb-3" data-testid="kb-corpus-overview-body">
          {loading && (
            <p className="typo-caption text-foreground py-2">{t.common.loading}</p>
          )}
          {error && (
            <p className="typo-caption text-red-400 flex items-center gap-1.5 py-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden />
              {t.vault.shared.corpus_overview_error}
            </p>
          )}
          {!loading && !error && map !== null && (
            <div className="max-h-64 overflow-y-auto rounded-card bg-background/40 px-3 py-2">
              <MarkdownRenderer content={map} />
            </div>
          )}
        </div>
      </Collapse>
    </div>
  );
}
