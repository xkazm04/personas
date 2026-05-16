import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';

interface BulkAddTagModalProps {
  count: number;
  onSubmit: (tag: string) => void;
  onClose: () => void;
}

export default function BulkAddTagModal({ count, onSubmit, onClose }: BulkAddTagModalProps) {
  const { t, tx } = useTranslation();
  const [tag, setTag] = useState('');
  const trimmed = tag.trim();

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center"
      onClick={onClose}
    >
      <div
        className="bg-card border border-primary/10 rounded-modal p-4 w-80 space-y-3 shadow-elevation-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-1">
          <h3 className="typo-section-title">{t.plugins.artist.gallery_bulk_tag_title}</h3>
          <p className="text-md text-foreground">
            {tx(t.plugins.artist.gallery_bulk_tag_subtitle, { count })}
          </p>
        </div>
        <input
          autoFocus
          value={tag}
          onChange={(e) => setTag(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed) onSubmit(trimmed);
            if (e.key === 'Escape') onClose();
          }}
          placeholder={t.plugins.artist.gallery_bulk_tag_placeholder}
          className="w-full px-3 py-2 rounded-card bg-background/80 border border-primary/10 text-md text-foreground placeholder:text-foreground focus:outline-none focus:border-rose-500/30"
        />
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            {t.common.cancel}
          </Button>
          <Button
            variant="accent"
            accentColor="rose"
            size="sm"
            disabled={!trimmed}
            onClick={() => onSubmit(trimmed)}
          >
            {t.plugins.artist.gallery_bulk_tag_apply}
          </Button>
        </div>
      </div>
    </div>
  );
}
