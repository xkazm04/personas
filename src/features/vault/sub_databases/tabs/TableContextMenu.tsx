import { useEffect, useRef } from 'react';
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

  // Keep menu within viewport
  const style: React.CSSProperties = {
    position: 'fixed',
    left: menu.x,
    top: menu.y,
    zIndex: 100,
  };

  return (
    <div ref={ref} style={style} className="min-w-[180px] py-1 rounded-card bg-background border border-primary/15 shadow-elevation-3">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 transition-colors text-left"
        onClick={() => { onCopyQuery(menu.tableName); onClose(); }}
      >
        <Copy className="w-3 h-3 text-foreground" />
        {db.copy_select_query}
      </button>
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-foreground hover:bg-secondary/50 transition-colors text-left"
        onClick={() => { onCopyName(menu.tableName); onClose(); }}
      >
        <Table2 className="w-3 h-3 text-foreground" />
        {db.copy_table_name}
      </button>
    </div>
  );
}
