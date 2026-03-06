import { useState, useRef, useCallback } from 'react';
import { useClickOutside } from '@/hooks/utility/useClickOutside';
import { MoreVertical, Eye, RefreshCw, Trash2 } from 'lucide-react';
import { BUTTON_VARIANTS } from '@/lib/utils/designTokens';

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
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeMenu = useCallback(() => setOpen(false), []);
  useClickOutside(menuRef, open, closeMenu);

  return (
    <div ref={menuRef} className={`relative ${open ? 'z-20' : ''}`}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="p-1 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-secondary/60 transition-all"
        aria-label="Row actions"
      >
        <MoreVertical className="w-4.5 h-4.5 text-muted-foreground/90" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-full mb-1 z-50 min-w-[180px] py-1.5 bg-background border border-primary/20 rounded-lg shadow-2xl backdrop-blur-sm">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onViewDetails();
            }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-foreground/80 hover:bg-primary/5 transition-colors text-left"
          >
            <Eye className="w-4 h-4" />
            View Details
          </button>
          {import.meta.env.VITE_DEVELOPMENT === 'true' && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onRebuild();
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-blue-400 hover:bg-blue-500/10 transition-colors text-left"
              >
                <RefreshCw className="w-4 h-4" />
                Rebuild
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  onDelete(reviewId);
                }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm transition-colors text-left ${BUTTON_VARIANTS.delete.text} ${BUTTON_VARIANTS.delete.hover}`}
              >
                <Trash2 className="w-4 h-4" />
                Delete template
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
