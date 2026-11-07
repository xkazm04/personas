import { useState } from 'react';
import { X, FolderOpen, Plus, Minus } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { kbIngestDirectory, kbPickDirectory } from '@/api/vault/database/vectorKb';
import { useTranslation } from '@/i18n/useTranslation';
import { KbErrorNotice } from '../KbErrorNotice';
import { extractMessage } from '@/lib/silentCatch';

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
      setError(extractMessage(err));
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
      setError(extractMessage(err));
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
      panelClassName="bg-background border border-hair rounded-card shadow-elevation-4 flex flex-col overflow-hidden"
    >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-3.5 border-b border-hair">
          <div className="w-7 h-7 rounded-card bg-role-agent/10 border border-role-agent/15 flex items-center justify-center">
            <FolderOpen className="w-3.5 h-3.5 text-role-agent" />
          </div>
          <h2 id="ingest-directory-title" className="typo-heading text-ink-1 flex-1">{sh.scan_directory}</h2>
          <Button
            type="button"
            onClick={onClose}
            aria-label={sh.close}
            variant="ghost"
            size="icon-sm"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="typo-caption text-foreground mb-1.5 block">{sh.directory_path}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 px-3 py-2 typo-code bg-surface-1 border border-hair rounded-card text-foreground min-h-[36px] flex items-center">
                {dirPath ? (
                  <span className="truncate">{dirPath}</span>
                ) : (
                  <span className="text-foreground">{sh.no_directory}</span>
                )}
              </div>
              <Button
                type="button"
                onClick={() => void handleBrowse()}
                disabled={browsing || ingesting}
                variant="ghost"
                size="md"
                className="shrink-0"
                icon={<FolderOpen className="w-3.5 h-3.5" />}
              >
                {browsing ? sh.browsing : sh.browse}
              </Button>
            </div>
          </div>

          <div>
            <label className="typo-caption text-foreground mb-1.5 block">
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
              <p className="typo-caption text-status-warning/80 mb-2">
                {sh.patterns_replace_defaults}
              </p>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {patterns.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 typo-caption px-2 py-1 text-role-agent/80">
                    {p}
                    <Button type="button" onClick={() => removePattern(p)} variant="ghost" size="icon-sm">
                      <Minus className="w-3 h-3" />
                    </Button>
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
                className="flex-1 px-2.5 py-1.5 typo-code bg-surface-1 border border-hair rounded-card text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-role-agent/40 transition-colors"
              />
              <Button
                type="button"
                onClick={addPattern}
                disabled={!customPattern.trim()}
                variant="ghost"
                size="icon-sm"
              >
                <Plus className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>

          {error && <KbErrorNotice raw={error} />}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-hair">
          <Button variant="ghost" onClick={onClose}>
            {t.common.cancel}
          </Button>
          {/*
            An ACTION control: the busy state is a real spinner on the button
            itself. This used to hand-paint a `border-white/*` ring — a banned
            color, and a fourth copy of a primitive `Button` already owns along
            with `disabled` and `aria-busy`.
          */}
          <Button
            variant="accent"
            tone="agent"
            loading={ingesting}
            loadingLabel={sh.scanning}
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
          >
            {sh.scan_ingest}
          </Button>
        </div>
    </BaseModal>
  );
}
