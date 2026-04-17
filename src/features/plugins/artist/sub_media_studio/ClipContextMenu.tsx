import { useEffect, useRef } from 'react';
import { Trash2, Copy, Scissors } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

interface ClipContextMenuProps {
  x: number;
  y: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onSplit?: () => void;
  onClose: () => void;
}

export default function ClipContextMenu({
  x,
  y,
  onDelete,
  onDuplicate,
  onSplit,
  onClose,
}: ClipContextMenuProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click or escape
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const items = [
    { icon: Copy, label: t.common.duplicate, action: onDuplicate },
    ...(onSplit ? [{ icon: Scissors, label: t.media_studio.split ?? 'Split', action: onSplit }] : []),
    { icon: Trash2, label: t.common.delete, action: onDelete, danger: true },
  ];

  return (
    <div
      ref={ref}
      className="fixed z-[100] min-w-[140px] py-1 bg-background border border-primary/15 rounded-xl shadow-elevation-4 animate-fade-slide-in"
      style={{ left: x, top: y }}
    >
      {items.map((item) => {
        const Icon = item.icon;
        const isDanger = 'danger' in item && item.danger;
        return (
          <button
            key={item.label}
            className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-md transition-colors ${
              isDanger
                ? 'text-red-400 hover:bg-red-500/10'
                : 'text-foreground hover:bg-secondary/40'
            }`}
            onClick={() => { item.action(); onClose(); }}
          >
            <Icon className="w-3.5 h-3.5" />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
