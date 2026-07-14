import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Play, AlertCircle } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';
import type { KnowledgeBase, KbExtractionSchema, KbEntity } from '@/api/vault/database/vectorKb';
import {
  kbInferSchema,
  kbRunExtraction,
  kbListEntities,
} from '@/api/vault/database/vectorKb';
import { SchemaEditor } from '../extract/SchemaEditor';
import { EntityTable } from '../extract/EntityTable';

const logger = createLogger('vector-kb-extract');

interface ExtractProgress {
  runId: string;
  kbId: string;
  status: string;
  documentsTotal: number;
  documentsDone: number;
  entitiesFound: number;
  currentDocument: string | null;
  error: string | null;
}

/**
 * Structured-extraction tab: the two-pass flow (infer schema -> review/edit ->
 * extract) that turns the KB's prose into queryable typed rows. See
 * `../DESIGN.md` for the rationale.
 */
export function ExtractTab({ kb }: { kb: KnowledgeBase }) {
  const { t, tx } = useTranslation();
  const sh = t.vault.shared;

  const [schema, setSchema] = useState<KbExtractionSchema | null>(null);
  const [entities, setEntities] = useState<KbEntity[]>([]);
  const [inferring, setInferring] = useState(false);
  const [progress, setProgress] = useState<ExtractProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  const running = progress != null && progress.status === 'running';

  const loadEntities = useCallback(async () => {
    try {
      setEntities(await kbListEntities(kb.id));
    } catch (err) {
      logger.error('Failed to load entities', { error: String(err) });
    }
  }, [kb.id]);

  useEffect(() => { void loadEntities(); }, [loadEntities]);

  // Live progress for the active run; refresh the entity table when it ends.
  const loadEntitiesRef = useRef(loadEntities);
  loadEntitiesRef.current = loadEntities;
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<ExtractProgress>('kb-extraction-progress', (event) => {
      if (event.payload.kbId !== kb.id) return;
      setProgress(event.payload);
      if (event.payload.status !== 'running') void loadEntitiesRef.current();
    }).then((fn) => { unlisten = fn; });
    return () => unlisten?.();
  }, [kb.id]);

  const handleInfer = useCallback(async () => {
    setInferring(true);
    setError(null);
    try {
      setSchema(await kbInferSchema(kb.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInferring(false);
    }
  }, [kb.id]);

  const handleRun = useCallback(async () => {
    if (!schema) return;
    setError(null);
    try {
      await kbRunExtraction(kb.id, schema);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [kb.id, schema]);

  if (kb.documentCount === 0) {
    return <p className="typo-body text-foreground text-center py-16">{sh.extract_empty_kb}</p>;
  }

  return (
    <div className="p-6 space-y-4">
      <p className="typo-body text-foreground max-w-2xl">{sh.extract_intro}</p>

      <div className="flex items-center gap-2">
        <button
          onClick={() => void handleInfer()}
          disabled={inferring || running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-violet-500/15 border border-violet-500/25 text-violet-300 hover:bg-violet-500/25 transition-colors disabled:opacity-50 typo-body"
        >
          {inferring ? <LoadingSpinner className="text-violet-400" /> : <Sparkles className="w-3.5 h-3.5" />}
          {inferring ? sh.extract_inferring : sh.extract_infer_btn}
        </button>

        {schema && (
          <button
            onClick={() => void handleRun()}
            disabled={running || schema.entities.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25 transition-colors disabled:opacity-50 typo-body"
          >
            {running ? <LoadingSpinner className="text-emerald-400" /> : <Play className="w-3.5 h-3.5" />}
            {running ? sh.extract_running : sh.extract_run_btn}
          </button>
        )}
      </div>

      {error && (
        <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 typo-body text-red-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {running && progress && (
        <p className="typo-caption text-foreground">
          {tx(sh.extract_progress, {
            done: progress.documentsDone,
            total: progress.documentsTotal,
            count: progress.entitiesFound,
          })}
        </p>
      )}

      {schema && (
        <div>
          <h3 className="typo-title text-primary mb-1">{sh.extract_schema_heading}</h3>
          <p className="typo-caption text-foreground mb-2">{sh.extract_schema_hint}</p>
          <SchemaEditor schema={schema} onChange={setSchema} />
        </div>
      )}

      <div className="rounded-card border border-border/30 overflow-x-auto">
        <EntityTable entities={entities} />
      </div>
    </div>
  );
}
