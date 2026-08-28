import { useState } from 'react';
import { X, FolderOpen, Plus, Minus } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { kbIngestDirectory, kbPickDirectory } from '@/api/vault/database/vectorKb';
import { useTranslation } from '@/i18n/useTranslation';

interface IngestDirectoryPickerProps {
  kbId: string;
  onClose: () => void;
  onIngestStarted: (jobId: string) => void;
}

/**
 * Mirror of the fallback extension list `kb_ingest_directory` applies when
 * `patterns` arrives empty (`src-tauri/src/commands/credentials/vector_kb.rs`).
 * This list is display-only — the backend never receives it — so its one job is
 * to be TRUE. It previously named 10 globs against the backend's 16, which is
 * how a user could believe `.tsx`, `.yml`, `.toml` or `.log` were out of scope
 * when they were being scanned all along.
 *
 * The backend branches on `patterns.is_empty()`: a non-empty list REPLACES this
 * set rather than extending it. That is the contract `file_patterns_hint`
 * describes ("empty = all supported"), and `patterns_replace_defaults` below
 * states it outright the moment the user adds one.
 */
const DEFAULT_PATTERNS = [
  '*.txt', '*.md', '*.html', '*.htm', '*.csv', '*.json', '*.yaml', '*.yml',
  '*.toml', '*.log', '*.rs', '*.py', '*.js', '*.ts', '*.tsx', '*.jsx',
];

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

  // Escape no longer needs a hand-written window-capture listener here: nesting
  // inside BaseModal registers this picker in the modal stack, and BaseModal
  // only honours Escape for the topmost entry — so the parent VectorKbModal
  // stays open by construction rather than by a stopPropagation race.

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
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="ingest-directory-title"
      size="md"
      containerClassName="fixed inset-0 z-[60] flex items-center justify-center p-4"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden"
    >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-primary/10">
          <div className="w-7 h-7 rounded-card bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
            <FolderOpen className="w-3.5 h-3.5 text-violet-400" />
          </div>
          <h2 id="ingest-directory-title" className="typo-heading font-semibold text-foreground/90 flex-1">{sh.scan_directory}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={sh.close}
            className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/80"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="typo-caption font-medium text-foreground mb-1.5 block">{sh.directory_path}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 typo-code bg-secondary/30 border border-primary/15 rounded-card text-foreground font-mono min-h-[36px] flex items-center">
                {dirPath ? (
                  <span className="truncate">{dirPath}</span>
                ) : (
                  <span className="text-foreground">{sh.no_directory}</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleBrowse()}
                disabled={browsing || ingesting}
                className="px-3 py-2 typo-body font-medium rounded-card bg-secondary/50 hover:bg-secondary/70 text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 flex items-center gap-1.5"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                {browsing ? sh.browsing : sh.browse}
              </button>
            </div>
          </div>

          <div>
            <label className="typo-caption font-medium text-foreground mb-1.5 block">
              {sh.file_patterns}
              <span className="text-foreground font-normal ml-1">{sh.file_patterns_hint}</span>
            </label>

            {/* Default patterns — shown even once the user has added their own,
                because that is exactly when they need to see what they are
                giving up. Hiding this list behind `patterns.length === 0` was
                what made the override silent. */}
            <p className="typo-caption text-foreground mb-2">
              {sh.default_patterns} {DEFAULT_PATTERNS.slice(0, 6).join(', ')}...
            </p>

            {/* Active patterns */}
            {patterns.length > 0 && (
              <>
              <p className="typo-caption text-amber-400/80 mb-2">
                {sh.patterns_replace_defaults}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {patterns.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 typo-caption px-2 py-1 rounded-card bg-violet-500/10 text-violet-400/80 border border-violet-500/15">
                    {p}
                    <button type="button" onClick={() => removePattern(p)} className="hover:text-red-400 transition-colors">
                      <Minus className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              </>
            )}

            {/* Add pattern */}
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={customPattern}
                onChange={(e) => setCustomPattern(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addPattern(); } }}
                placeholder={sh.add_pattern_placeholder}
                className="flex-1 px-2.5 py-1.5 typo-code bg-secondary/30 border border-primary/15 rounded-card text-foreground font-mono placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/40 transition-colors"
              />
              <button
                type="button"
                onClick={addPattern}
                disabled={!customPattern.trim()}
                className="p-1.5 rounded-card bg-secondary/40 hover:bg-secondary/60 text-foreground transition-colors disabled:opacity-30"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 typo-body text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 typo-body rounded-card hover:bg-secondary/50 text-foreground transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            className="px-4 py-2 typo-body font-medium rounded-card bg-violet-600/80 hover:bg-violet-600 text-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
    </BaseModal>
  );
}
