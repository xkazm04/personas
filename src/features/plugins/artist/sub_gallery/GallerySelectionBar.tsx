import { useEffect, useState } from 'react';
import { Tag, Trash2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { Button } from '@/features/shared/components/buttons';
import BulkAddTagModal from './BulkAddTagModal';

interface GallerySelectionBarProps {
  count: number;
  onDelete: () => void;
  onAddTag: (tag: string) => void;
  onClear: () => void;
}

/**
 * Floating action bar shown above the gallery grid when there is an active
 * multi-selection. The Delete control uses a two-step confirm (first click
 * arms a "click again" state that auto-clears after 3s) so a misclick in a
 * busy grid does not lose user files irreversibly.
 */
export default function GallerySelectionBar({
  count,
  onDelete,
  onAddTag,
  onClear,
}: GallerySelectionBarProps) {
  const { t, tx } = useTranslation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tagModalOpen, setTagModalOpen] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const id = window.setTimeout(() => setConfirmingDelete(false), 3000);
    return () => window.clearTimeout(id);
  }, [confirmingDelete]);

  return (
    <>
      <div className="sticky top-0 z-20 -mx-2 px-3 py-2 rounded-card bg-rose-500/10 border border-rose-500/20 backdrop-blur flex items-center gap-2 shadow-elevation-2">
        <span className="typo-label text-foreground">
          {tx(t.plugins.artist.gallery_n_selected, { count })}
        </span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setTagModalOpen(true)}
          title={t.plugins.artist.gallery_bulk_tag_button}
        >
          <Tag className="w-3.5 h-3.5" />
          {t.plugins.artist.gallery_bulk_tag_button}
        </Button>
        {confirmingDelete ? (
          <>
            <Button
              variant="accent"
              accentColor="rose"
              size="sm"
              onClick={() => {
                setConfirmingDelete(false);
                onDelete();
              }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              {tx(t.plugins.artist.gallery_confirm_delete_n, { count })}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
              {t.common.cancel}
            </Button>
          </>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            title={t.plugins.artist.gallery_delete_selected}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t.plugins.artist.gallery_delete_selected}
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={onClear}
          title={t.plugins.artist.gallery_clear_selection}
        >
          <X className="w-3.5 h-3.5" />
        </Button>
      </div>

      {tagModalOpen && (
        <BulkAddTagModal
          count={count}
          onSubmit={(tag) => {
            setTagModalOpen(false);
            onAddTag(tag);
          }}
          onClose={() => setTagModalOpen(false)}
        />
      )}
    </>
  );
}
