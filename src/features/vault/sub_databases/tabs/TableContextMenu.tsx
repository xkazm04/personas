import { Copy, Table2 } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { ContextMenu } from '@/features/shared/components/overlays/ContextMenu';

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

/** Table right-click menu. The positioning, dismissal and keyboard behaviour
 *  it used to own by hand now come from the shared `ContextMenu`; this file is
 *  the two items and their labels. */
export function TableContextMenu({ menu, onCopyQuery, onCopyName, onClose }: TableContextMenuProps) {
  const { t } = useTranslation();
  const db = t.vault.databases;

  return (
    <ContextMenu
      x={menu.x}
      y={menu.y}
      onClose={onClose}
      widthClass="min-w-[180px]"
      zIndex={100}
      ariaLabel={menu.tableName}
      items={[
        {
          id: 'copy-query',
          label: db.copy_select_query,
          icon: <Copy className="w-3.5 h-3.5" />,
          onSelect: () => onCopyQuery(menu.tableName),
        },
        {
          id: 'copy-name',
          label: db.copy_table_name,
          icon: <Table2 className="w-3.5 h-3.5" />,
          onSelect: () => onCopyName(menu.tableName),
        },
      ]}
    />
  );
}
