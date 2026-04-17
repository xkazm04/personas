import { useState } from 'react';
import { X, Type } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { kbIngestText } from '@/api/vault/database/vectorKb';
import { useTranslation } from '@/i18n/useTranslation';

interface IngestTextModalProps {
  kbId: string;
  onClose: () => void;
  onIngested: () => void;
}

export function IngestTextModal({ kbId, onClose, onIngested }: IngestTextModalProps) {
  const { t } = useTranslation();
  const sh = t.vault.shared;
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [ingesting, setIngesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = title.trim().length > 0 && text.trim().length > 0 && !ingesting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setIngesting(true);
    setError(null);

    try {
      await kbIngestText(kbId, title.trim(), text.trim());
      setIngesting(false);
      onIngested();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIngesting(false);
    }
  };

  return (
    <BaseModal
      isOpen
      onClose={onClose}
      titleId="ingest-text-title"
      size="md"
      containerClassName="fixed inset-0 z-[60] flex items-center justify-center p-4"
      panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-primary/10">
        <div className="w-7 h-7 rounded-card bg-violet-500/10 border border-violet-500/15 flex items-center justify-center">
          <Type className="w-3.5 h-3.5 text-violet-400" />
        </div>
        <h2 id="ingest-text-title" className="text-sm font-semibold text-foreground/90 flex-1">{sh.paste_text}</h2>
        <button
          onClick={onClose}
          className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-muted-foreground/60 hover:text-foreground/80"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground/60 mb-1.5 block">{sh.title_label}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={sh.title_placeholder}
            className="w-full px-3 py-2 text-sm bg-secondary/30 border border-primary/15 rounded-card text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-violet-500/40 transition-colors"
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground/60 mb-1.5 block">
            {sh.content_label}
            {text.length > 0 && (
              <span className="ml-2 text-muted-foreground/40">{text.length.toLocaleString()} chars</span>
            )}
          </label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={sh.content_placeholder}
            rows={12}
            className="w-full px-3 py-2 text-sm bg-secondary/30 border border-primary/15 rounded-card text-foreground placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:border-violet-500/40 transition-colors resize-none font-mono"
          />
        </div>

        {error && (
          <div className="p-3 rounded-card bg-red-500/10 border border-red-500/20 text-sm text-red-400">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm rounded-card hover:bg-secondary/50 text-foreground/70 transition-colors"
        >
          {t.common.cancel}
        </button>
        <button
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="px-4 py-2 text-sm font-medium rounded-card bg-violet-600/80 hover:bg-violet-600 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {ingesting ? (
            <span className="flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              {sh.ingesting}
            </span>
          ) : (
            sh.ingest
          )}
        </button>
      </div>
    </BaseModal>
  );
}
