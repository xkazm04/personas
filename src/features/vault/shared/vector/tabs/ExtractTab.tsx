import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, Play, AlertCircle } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import { createLogger } from '@/lib/log';
import { trackInteraction } from '@/lib/analytics';
import type { KnowledgeBase, KbExtractionSchema, KbEntity } from '@/api/vault/database/vectorKb';
// The payload of `kb-extraction-progress` is a generated contract; this file
// used to re-declare it by hand, so a Rust-side field change would have drifted
// silently instead of failing the type-check.
import type { KbExtractionProgress } from '@/lib/bindings/KbExtractionProgress';
import {
  kbInferSchema,
  kbRunExtraction,
  kbListEntities,
} from '@/api/vault/database/vectorKb';
import { SchemaEditor } from '../extract/SchemaEditor';
import { EntityTable } from '../extract/EntityTable';

const logger = createLogger('vector-kb-extract');

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
  const [progress, setProgress] = useState<KbExtractionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `kb_run_extraction` returns as soon as the job is spawned, so `running`
  // (derived from the first progress event) is still false for the round trip
  // after the click. Without this latch a second click spawns a second run over
  // the same corpus, doubling the model spend and the rows written.
  const [starting, setStarting] = useState(false);

  const running = progress != null && progress.status === 'running';
  const busy = running || starting;
  const startingRef = useRef(false);

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
    void listen<KbExtractionProgress>('kb-extraction-progress', (event) => {
      if (event.payload.kbId !== kb.id) return;
      setProgress(event.payload);
      if (event.payload.status !== 'running') {
        // A run that ends in failure carries its reason here and nowhere else:
        // the progress line below is gated on `running`, so without this the
        // run simply stops and the user is told nothing.
        if (event.payload.error) setError(event.payload.error);
        void loadEntitiesRef.current();
      }
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
    if (!schema || startingRef.current) return;
    startingRef.current = true;
    setStarting(true);
    setError(null);
    try {
      await kbRunExtraction(kb.id, schema);
      // Extraction is the most expensive operation in this feature and nothing
      // recorded that it ever ran. Shape counts only, no corpus content.
      trackInteraction('vector_kb', 'extraction_run', `entityTypes=${schema.entities.length}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      startingRef.current = false;
      setStarting(false);
    }
  }, [kb.id, schema]);

  if (kb.documentCount === 0) {
    return <p className="typo-body text-foreground text-center py-16">{sh.extract_empty_kb}</p>;
  }

  return (
    <div className="p-6 space-y-4">
      <p className="typo-body text-foreground max-w-2xl">{sh.extract_intro}</p>

      {/*
        Both controls are ACTION buttons, so the busy state has to be a real
        spinner on the control itself. They used to render `LoadingSpinner`,
        which returns null — the icon vanished and nothing took its place.
        `Button loading` owns the spinner, the dim, `disabled` and `aria-busy`.
      */}
      <div className="flex items-center gap-2">
        <Button
          variant="accent"
          accentColor="violet"
          size="sm"
          icon={<Sparkles className="w-3.5 h-3.5" />}
          loading={inferring}
          loadingLabel={sh.extract_inferring}
          disabled={busy}
          onClick={() => void handleInfer()}
        >
          {sh.extract_infer_btn}
        </Button>

        {schema && (
          <Button
            variant="accent"
            accentColor="emerald"
            size="sm"
            icon={<Play className="w-3.5 h-3.5" />}
            loading={busy}
            loadingLabel={sh.extract_running}
            disabled={schema.entities.length === 0}
            onClick={() => void handleRun()}
          >
            {sh.extract_run_btn}
          </Button>
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
