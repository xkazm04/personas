import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { MoreVertical, Eye, RefreshCw, Trash2, X } from 'lucide-react';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import { BaseModal } from '@/lib/ui/BaseModal';
import Button from '@/features/shared/components/buttons/Button';
import { PressSurface } from '@/features/shared/components/buttons/PressSurface';

interface RowActionMenuProps {
  reviewId: string;
  onDelete: (id: string) => void;
  onViewDetails: () => void;
  onRebuild: () => void;
}

export function RowActionMenu({
  reviewId,
  onDelete,
  onViewDetails,
  onRebuild,
}: RowActionMenuProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <Button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        variant="ghost"
        size="icon-sm"
        className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={t.templates.row_actions.row_actions_label}
      >
        <MoreVertical className="w-4.5 h-4.5 text-foreground" />
      </Button>
      <BaseModal
        isOpen={open}
        onClose={close}
        titleId="row-actions-title"
        size="sm"
        panelClassName="bg-background border border-hair rounded-card shadow-elevation-4 overflow-hidden"
        portal
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-hair">
            <h2 id="row-actions-title" className="typo-heading text-ink-1">
              {t.templates.row_actions.row_actions_label}
            </h2>
            <Button
              type="button"
              onClick={close}
              variant="ghost"
              size="icon-sm"
              aria-label={t.common.close}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
          <div className="py-1.5">
            <PressSurface
              onPress={(e) => {
                e.stopPropagation();
                close();
                onViewDetails();
              }}
              data-testid="menu-view-details"
              className="w-full flex items-center gap-3 px-5 py-3 typo-body text-ink-1"
            >
              <Eye className="w-4 h-4" />
              {t.templates.row_actions.view_details}
            </PressSurface>
            {import.meta.env.DEV && (
              <>
                <PressSurface
                  onPress={(e) => {
                    e.stopPropagation();
                    close();
                    onRebuild();
                  }}
                  className="w-full flex items-center gap-3 px-5 py-3 typo-body text-status-info"
                >
                  <RefreshCw className="w-4 h-4" />
                  {t.templates.row_actions.rebuild}
                </PressSurface>
                <PressSurface
                  onPress={(e) => {
                    e.stopPropagation();
                    close();
                    onDelete(reviewId);
                  }}
                  className={`w-full flex items-center gap-3 px-5 py-3 typo-body ${BUTTON_VARIANTS.delete.text}`}
                >
                  <Trash2 className="w-4 h-4" />
                  {t.templates.row_actions.delete_template}
                </PressSurface>
              </>
            )}
          </div>
        </div>
      </BaseModal>
    </>
  );
}
