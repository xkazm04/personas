import { useState, useEffect, useCallback } from 'react';
import { FileText, Trash2, Upload, FolderOpen, Type, RefreshCw, AlertCircle, FileSearch } from 'lucide-react';
import { createLogger } from '@/lib/log';

const logger = createLogger('vector-kb-documents');
import { EmptyIllustration } from '@/features/shared/components/display/EmptyIllustration';
import type { KnowledgeBase, KbDocument } from '@/api/vault/database/vectorKb';
import { kbListDocuments, kbDeleteDocument, kbPickFiles, kbIngestFiles } from '@/api/vault/database/vectorKb';
import { IngestDropZone } from '../ingest/IngestDropZone';
import { IngestTextModal } from '../ingest/IngestTextModal';
import { IngestDirectoryPicker } from '../ingest/IngestDirectoryPicker';
import { IngestProgressBar } from '../ingest/IngestProgressBar';
import { StatusBadge } from './StatusBadge';
import { truncatePath, formatBytes } from './documentTabHelpers';

interface DocumentsTabProps {
  kb: KnowledgeBase;
  onRefresh: () => void;
}

export function DocumentsTab({ kb, onRefresh }: DocumentsTabProps) {
  const [documents, setDocuments] = useState<KbDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTextModal, setShowTextModal] = useState(false);
  const [showDirPicker, setShowDirPicker] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const docs = await kbListDocuments(kb.id);
      setDocuments(docs);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [kb.id]);

  useEffect(() => {
    void fetchDocuments();
  }, [fetchDocuments]);

  const handleDelete = useCallback(async (docId: string) => {
    setDeletingId(docId);
    try {
      await kbDeleteDocument(docId);
      setDocuments((prev) => prev.filter((d) => d.id !== docId));
      onRefresh();
    } catch (err) {
      logger.error('Delete failed', { error: String(err) });
    } finally {
      setDeletingId(null);
    }
  }, [onRefresh]);

  const handleBrowseFiles = useCallback(async () => {
    try {
      const paths = await kbPickFiles();
      if (paths.length === 0) return;
      const jobId = await kbIngestFiles(kb.id, paths);
      setActiveJobId(jobId);
    } catch (err) {
      logger.error('Browse files ingestion failed', { error: String(err) });
    }
  }, [kb.id]);

  const handleIngestStarted = useCallback((jobId: string) => {
    setActiveJobId(jobId);
  }, []);

  const handleIngestComplete = useCallback(() => {
    setActiveJobId(null);
    void fetchDocuments();
    onRefresh();
  }, [fetchDocuments, onRefresh]);

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-primary/10 shrink-0">
        <h3 className="text-sm font-medium text-foreground/80 flex-1">
          {documents.length} document{documents.length !== 1 ? 's' : ''}
        </h3>
        <button
          onClick={() => void fetchDocuments()}
          className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
          title="Refresh"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setShowTextModal(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/40 hover:bg-secondary/60 text-foreground/80 transition-colors"
        >
          <Type className="w-3 h-3" />
          Paste Text
        </button>
        <button
          onClick={() => void handleBrowseFiles()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/40 hover:bg-secondary/60 text-foreground/80 transition-colors"
        >
          <FileSearch className="w-3 h-3" />
          Browse Files
        </button>
        <button
          onClick={() => setShowDirPicker(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-secondary/40 hover:bg-secondary/60 text-foreground/80 transition-colors"
        >
          <FolderOpen className="w-3 h-3" />
          Directory
        </button>
      </div>

      {/* Active ingestion progress */}
      {activeJobId && (
        <div className="px-6 py-2 border-b border-primary/10">
          <IngestProgressBar
            kbId={kb.id}
            jobId={activeJobId}
            onComplete={handleIngestComplete}
          />
        </div>
      )}

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {loading && documents.length === 0 && (
          <div className="flex items-center justify-center py-20">
            <div className="w-6 h-6 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
          </div>
        )}

        {error && (
          <div className="mx-6 mt-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {!loading && documents.length === 0 && !error && (
          <IngestDropZone kbId={kb.id} onIngestStarted={handleIngestStarted}>
            <EmptyIllustration
              icon={Upload}
              heading="No documents yet"
              description="Drop files here, paste text, or scan a directory to start building your knowledge base."
              className="py-20"
            />
          </IngestDropZone>
        )}

        {documents.length > 0 && (
          <IngestDropZone kbId={kb.id} onIngestStarted={handleIngestStarted}>
            <div className="p-4 space-y-1">
              {documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="animate-fade-slide-in flex items-center gap-3 px-4 py-3 rounded-xl hover:bg-secondary/30 transition-colors group"
                  >
                    <div className="w-8 h-8 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4 text-violet-400/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground/90 truncate">{doc.title}</p>
                      <p className="text-xs text-muted-foreground/50 mt-0.5">
                        {doc.sourceType}
                        {doc.sourcePath && <span className="ml-1.5">-- {truncatePath(doc.sourcePath)}</span>}
                        <span className="ml-1.5">{formatBytes(doc.byteSize)}</span>
                        <span className="ml-1.5">{doc.chunkCount} chunks</span>
                      </p>
                    </div>
                    <StatusBadge status={doc.status} error={doc.errorMessage} />
                    <button
                      onClick={() => void handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      className="p-1.5 rounded-lg text-red-400/0 group-hover:text-red-400/60 hover:!text-red-400 hover:bg-red-500/10 transition-all disabled:opacity-50"
                      title="Delete document"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
            </div>
          </IngestDropZone>
        )}
      </div>

      {/* Modals */}
      {showTextModal && (
        <IngestTextModal
          kbId={kb.id}
          onClose={() => setShowTextModal(false)}
          onIngested={() => { setShowTextModal(false); void fetchDocuments(); onRefresh(); }}
        />
      )}
      {showDirPicker && (
        <IngestDirectoryPicker
          kbId={kb.id}
          onClose={() => setShowDirPicker(false)}
          onIngestStarted={(jobId) => { setShowDirPicker(false); handleIngestStarted(jobId); }}
        />
      )}
    </div>
  );
}
