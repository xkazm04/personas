import { useEffect, useRef } from 'react';
import { Copy, Table2 } from 'lucide-react';

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
    <div ref={ref} style={style} className="min-w-[180px] py-1 rounded-lg bg-background border border-primary/15 shadow-xl">
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground/70 hover:bg-secondary/50 transition-colors text-left"
        onClick={() => { onCopyQuery(menu.tableName); onClose(); }}
      >
        <Copy className="w-3 h-3 text-muted-foreground/40" />
        Copy SELECT query
      </button>
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-foreground/70 hover:bg-secondary/50 transition-colors text-left"
        onClick={() => { onCopyName(menu.tableName); onClose(); }}
      >
        <Table2 className="w-3 h-3 text-muted-foreground/40" />
        Copy table name
      </button>
    </div>
  );
}
