import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { MoreVertical, Eye, RefreshCw, Trash2, X } from 'lucide-react';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';
import { BaseModal } from '@/lib/ui/BaseModal';

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
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="p-1 rounded-card opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-secondary/60 transition-all"
        aria-label={t.templates.row_actions.row_actions_label}
      >
        <MoreVertical className="w-4.5 h-4.5 text-foreground" />
      </button>
      <BaseModal
        isOpen={open}
        onClose={close}
        titleId="row-actions-title"
        size="sm"
        panelClassName="bg-background border border-primary/15 rounded-2xl shadow-elevation-4 overflow-hidden"
        portal
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="flex flex-col"
        >
          <div className="flex items-center justify-between px-5 py-3.5 border-b border-primary/10">
            <h2 id="row-actions-title" className="typo-heading font-semibold text-foreground/90">
              {t.templates.row_actions.row_actions_label}
            </h2>
            <button
              onClick={close}
              className="p-1.5 rounded-card hover:bg-secondary/50 transition-colors text-foreground hover:text-foreground/95"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="py-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                close();
                onViewDetails();
              }}
              data-testid="menu-view-details"
              className="w-full flex items-center gap-3 px-5 py-3 typo-body text-foreground hover:bg-primary/5 transition-colors text-left"
            >
              <Eye className="w-4 h-4" />
              {t.templates.row_actions.view_details}
            </button>
            {import.meta.env.DEV && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onRebuild();
                  }}
                  className="w-full flex items-center gap-3 px-5 py-3 typo-body text-blue-400 hover:bg-blue-500/10 transition-colors text-left"
                >
                  <RefreshCw className="w-4 h-4" />
                  {t.templates.row_actions.rebuild}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    close();
                    onDelete(reviewId);
                  }}
                  className={`w-full flex items-center gap-3 px-5 py-3 typo-body transition-colors text-left ${BUTTON_VARIANTS.delete.text} ${BUTTON_VARIANTS.delete.hover}`}
                >
                  <Trash2 className="w-4 h-4" />
                  {t.templates.row_actions.delete_template}
                </button>
              </>
            )}
          </div>
        </div>
      </BaseModal>
    </>
  );
}
