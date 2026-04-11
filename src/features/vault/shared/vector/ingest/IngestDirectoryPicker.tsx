import { useState, useEffect } from 'react';
import { X, FolderOpen, Plus, Minus } from 'lucide-react';
import { kbIngestDirectory, kbPickDirectory } from '@/api/vault/database/vectorKb';
import { useTranslation } from '@/i18n/useTranslation';

interface IngestDirectoryPickerProps {
  kbId: string;
  onClose: () => void;
  onIngestStarted: (jobId: string) => void;
}

const DEFAULT_PATTERNS = ['*.txt', '*.md', '*.html', '*.csv', '*.json', '*.yaml', '*.rs', '*.py', '*.js', '*.ts'];

export function IngestDirectoryPicker({ kbId, onClose, onIngestStarted }: IngestDirectoryPickerProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [dirPath, setDirPath] = useState('');
  const [patterns, setPatterns] = useState<string[]>([]);
  const [customPattern, setCustomPattern] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleBrowse = async () => {
    setBrowsing(true);
    setError(null);
    try {
      const selected = await kbPickDirectory();
      if (selected) setDirPath(selected);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBrowsing(false);
    }
  };

  // Stop Escape from propagating to parent VectorKbModal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [onClose]);

  const canSubmit = dirPath.trim().length > 0 && !ingesting;

  const addPattern = () => {
    const p = customPattern.trim();
    if (p && !patterns.includes(p)) {
      setPatterns([...patterns, p]);
      setCustomPattern('');
    }
  };

  const removePattern = (p: string) => {
    setPatterns(patterns.filter((x) => x !== p));
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIngesting(true);
    setError(null);

    try {
      const jobId = await kbIngestDirectory(kbId, dirPath.trim(), patterns);
      setIngesting(false);
      onIngestStarted(jobId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIngesting(false);
    }
  };

  return (
    <div
      className="animate-fade-slide-in fixed inset-0 z-[60] flex items-center justify-center p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      <div
        className="animate-fade-slide-in relative w-full max-w-md bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-primary/10">
          <div className="w-7 h-7 rounded-lg bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
            <FolderOpen className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <h2 className="text-sm font-semibold text-foreground/90 flex-1">{sh.scan_directory}</h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground/60 mb-1.5 block">{sh.directory_path}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 text-sm bg-secondary/30 border border-primary/15 rounded-lg text-foreground font-mono min-h-[36px] flex items-center">
                {dirPath ? (
                  <span className="truncate">{dirPath}</span>
                ) : (
                  <span className="text-muted-foreground/40">{sh.no_directory}</span>
                )}
              </div>
              <button
                onClick={() => void handleBrowse()}
                disabled={browsing || ingesting}
                className="px-3 py-2 text-sm font-medium rounded-lg bg-secondary/50 hover:bg-secondary/70 text-foreground/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {browsing ? sh.browsing : sh.browse}
              </button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground/60 mb-1.5 block">
              {sh.file_patterns}
              <span className="text-muted-foreground/40 font-normal ml-1">{sh.file_patterns_hint}</span>
            </label>

            {/* Default patterns hint */}
            {patterns.length === 0 && (
              <p className="text-xs text-muted-foreground/40 mb-2">
                Default: {DEFAULT_PATTERNS.slice(0, 6).join(', ')}...
              </p>
            )}

            {/* Active patterns */}
            {patterns.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {patterns.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-violet-500/10 text-violet-400/80 border border-violet-500/15">
                    {p}
                    <button onClick={() => removePattern(p)} className="hover:text-red-400 transition-colors">
                      <Minus className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add pattern */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={customPattern}
                onChange={(e) => setCustomPattern(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPattern(); } }}
                placeholder="*.pdf"
                className="flex-1 px-2.5 py-1.5 text-xs bg-secondary/30 border border-primary/15 rounded-lg text-foreground font-mono placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-violet-500/40 transition-colors"
              />
              <button
                onClick={addPattern}
                disabled={!customPattern.trim()}
                className="p-1.5 rounded-lg bg-secondary/40 hover:bg-secondary/60 text-foreground/70 transition-colors disabled:opacity-30"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg hover:bg-secondary/50 text-foreground/70 transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-violet-600/80 hover:bg-violet-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {ingesting ? (
              <span className="flex items-center gap-2">
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                {sh.scanning}
              </span>
            ) : (
              sh.scan_ingest
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
