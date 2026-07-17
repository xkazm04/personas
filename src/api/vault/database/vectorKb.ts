import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

import type { KnowledgeBase } from "@/lib/bindings/KnowledgeBase";
import type { KbDocument } from "@/lib/bindings/KbDocument";
import type { VectorSearchResult } from "@/lib/bindings/VectorSearchResult";
import type { KbSearchQuery } from "@/lib/bindings/KbSearchQuery";
import type { KbSearchResponse } from "@/lib/bindings/KbSearchResponse";
import type { KbIngestProgress } from "@/lib/bindings/KbIngestProgress";
import type { KbExtractionSchema } from "@/lib/bindings/KbExtractionSchema";
import type { KbExtractionRun } from "@/lib/bindings/KbExtractionRun";
import type { KbEntity } from "@/lib/bindings/KbEntity";
export type { KnowledgeBase, KbDocument, VectorSearchResult, KbSearchQuery, KbSearchResponse, KbIngestProgress };
export type { KbExtractionSchema, KbExtractionRun, KbEntity };

// ============================================================================
// Knowledge Base CRUD
// ============================================================================

export const createKnowledgeBase = (name: string, description?: string) =>
  invoke<KnowledgeBase>('create_knowledge_base', { name, description });

export const listKnowledgeBases = () =>
  invoke<KnowledgeBase[]>('list_knowledge_bases');

export const getKnowledgeBase = (kbId: string) =>
  invoke<KnowledgeBase>('get_knowledge_base', { kbId });

export const deleteKnowledgeBase = (kbId: string) =>
  invoke<void>('delete_knowledge_base', { kbId });

// ============================================================================
// Native File/Directory Pickers
// ============================================================================

export const kbPickFiles = () =>
  invoke<string[]>('kb_pick_files');

export const kbPickDirectory = () =>
  invoke<string | null>('kb_pick_directory');

// ============================================================================
// Document Ingestion
// ============================================================================

export const kbIngestFiles = (kbId: string, filePaths: string[]) =>
  invoke<string>('kb_ingest_files', { kbId, filePaths });

export const kbIngestText = (kbId: string, title: string, text: string) =>
  invoke<number>('kb_ingest_text', { kbId, title, text });

export const kbIngestDirectory = (kbId: string, dirPath: string, patterns: string[] = []) =>
  invoke<string>('kb_ingest_directory', { kbId, dirPath, patterns });

/**
 * Re-embed the entire knowledge base with the current embedding model
 * (drops + recreates the vector index, re-embeds every stored chunk).
 * Returns the job id; progress arrives on the same `kb:ingest_progress` /
 * `kb:ingest_complete` events as ingestion.
 */
export const kbReindex = (kbId: string) =>
  invoke<string>('kb_reindex', { kbId });

// ============================================================================
// Search
// ============================================================================

/**
 * Semantic search over one knowledge base. The response carries the ranked
 * hits plus `floorFiltered` — how many vector candidates the shared relevance
 * floor removed before ranking (a high count means the corpus has little that
 * is actually close to the query).
 */
export const kbSearch = (query: KbSearchQuery) =>
  invoke<KbSearchResponse>('kb_search', { query });

// ============================================================================
// Document Management
// ============================================================================

export const kbListDocuments = (kbId: string) =>
  invoke<KbDocument[]>('kb_list_documents', { kbId });

/**
 * A compact Markdown overview of the knowledge base — what documents it holds,
 * how large each is, and which parts are unreadable scans. The same map the
 * twin retrieval context prepends when a KB is bound; here it backs the
 * Documents tab's collapsible "corpus overview".
 */
export const kbCorpusMap = (kbId: string) =>
  invoke<string>('kb_corpus_map', { kbId });

export const kbDeleteDocument = (documentId: string) =>
  invoke<void>('kb_delete_document', { documentId });

// ============================================================================
// Structured Extraction (two-pass: infer schema -> review -> run)
// ============================================================================

/** Pass 1: propose an extraction schema by sampling the KB (one LLM call). */
export const kbInferSchema = (kbId: string) =>
  invoke<KbExtractionSchema>('kb_infer_schema', { kbId });

/** Pass 2: run extraction against an approved schema. Returns the run id;
 *  progress arrives on the `kb-extraction-progress` event. */
export const kbRunExtraction = (kbId: string, schema: KbExtractionSchema) =>
  invoke<string>('kb_run_extraction', { kbId, schema });

export const kbListExtractionRuns = (kbId: string) =>
  invoke<KbExtractionRun[]>('kb_list_extraction_runs', { kbId });

export const kbListEntities = (kbId: string, entityType?: string) =>
  invoke<KbEntity[]>('kb_list_entities', { kbId, entityType: entityType ?? null });
