import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Copy, Table2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';

export interface TableContextMenuState {
  x: number;
  y: number;
  tableName: string;
}

interface TableContextMenuProps {
  menu: TableContextMenuState;
  onCopyQuery: (tableName: string) => void;
  onCopyName: (tableName: string) => void;
  onClose: () => void;
}

export function TableContextMenu({ menu, onCopyQuery, onCopyName, onClose }: TableContextMenuProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const handleScroll = () => onClose();

    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    document.addEventListener('scroll', handleScroll, true);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
      document.removeEventListener('scroll', handleScroll, true);
    };
  }, [onClose]);

  // Keep the menu within the viewport: a right-click near the right or bottom
  // edge would otherwise place it partly (or, in the corner, almost entirely)
  // off-screen with no way to scroll to it, since the menu is position: fixed.
  // Measured after mount because the size depends on the translated labels.
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const MARGIN = 8;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      x: Math.max(MARGIN, Math.min(menu.x, window.innerWidth - width - MARGIN)),
      y: Math.max(MARGIN, Math.min(menu.y, window.innerHeight - height - MARGIN)),
    });
  }, [menu.x, menu.y]);

  const style: React.CSSProperties = {
    position: 'fixed',
    left: pos.x,
    top: pos.y,
    zIndex: 100,
  };

  return (
    <div ref={ref} style={style} className="min-w-[180px] py-1 rounded-card bg-background border border-primary/15 shadow-elevation-3">
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/50 transition-colors text-left"
        onClick={() => { onCopyQuery(menu.tableName); onClose(); }}
      >
        <Copy className="w-3 h-3 text-foreground" />
        {db.copy_select_query}
      </button>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-3 py-1.5 typo-body text-foreground hover:bg-secondary/50 transition-colors text-left"
        onClick={() => { onCopyName(menu.tableName); onClose(); }}
      >
        <Table2 className="w-3 h-3 text-foreground" />
        {db.copy_table_name}
      </button>
    </div>
  );
}
