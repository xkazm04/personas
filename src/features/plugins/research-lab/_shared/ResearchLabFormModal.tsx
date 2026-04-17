import { useId, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { BaseModal } from '@/lib/ui/BaseModal';
import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  title: string;
  isOpen?: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  submitLabel: string;
  submitDisabled?: boolean;
  saving?: boolean;
  children: ReactNode;
}

export function ResearchLabFormModal({
  title,
  isOpen = true,
  onClose,
  onSubmit,
  submitLabel,
  submitDisabled,
  saving,
  children,
}: Props) {
  const { t } = useTranslation();
  const titleId = useId();

  return (
    <BaseModal isOpen={isOpen} onClose={onClose} titleId={titleId} size="sm" portal>
      <form
        onSubmit={onSubmit}
        className="flex flex-col max-h-[85vh] bg-background rounded-2xl overflow-hidden"
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-border/20">
          <h2 id={titleId} className="typo-section-title">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-secondary/50 text-foreground"
            aria-label={t.common.cancel}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {children}
        </div>

        <footer className="flex justify-end gap-3 px-6 py-4 border-t border-border/20 bg-secondary/20">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg typo-body text-foreground hover:bg-secondary/50 transition-colors"
          >
            {t.common.cancel}
          </button>
          <button
            type="submit"
            disabled={submitDisabled || saving}
            className="px-4 py-2 rounded-lg typo-body bg-primary/20 text-primary hover:bg-primary/30 transition-colors disabled:opacity-50"
          >
            {saving ? t.common.loading : submitLabel}
          </button>
        </footer>
      </form>
    </BaseModal>
  );
}
