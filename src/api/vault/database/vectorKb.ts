import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

import type { KnowledgeBase } from "@/lib/bindings/KnowledgeBase";
import type { KbDocument } from "@/lib/bindings/KbDocument";
import type { VectorSearchResult } from "@/lib/bindings/VectorSearchResult";
import type { KbSearchQuery } from "@/lib/bindings/KbSearchQuery";
import type { KbIngestProgress } from "@/lib/bindings/KbIngestProgress";
export type { KnowledgeBase, KbDocument, VectorSearchResult, KbSearchQuery, KbIngestProgress };

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

// ============================================================================
// Search
// ============================================================================

export const kbSearch = (query: KbSearchQuery) =>
  invoke<VectorSearchResult[]>('kb_search', { query });

// ============================================================================
// Document Management
// ============================================================================

export const kbListDocuments = (kbId: string) =>
  invoke<KbDocument[]>('kb_list_documents', { kbId });

export const kbDeleteDocument = (documentId: string) =>
  invoke<void>('kb_delete_document', { documentId });
