import { Trash2, Copy, Scissors } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  ContextMenu,
  type ContextMenuItem,
} from '@/features/shared/components/overlays/ContextMenu';

interface ClipContextMenuProps {
  x: number;
  y: number;
  onDelete: () => void;
  onDuplicate: () => void;
  onSplit?: () => void;
  onClose: () => void;
}

/** Timeline-clip right-click menu, on the shared `ContextMenu` primitive. */
export default function ClipContextMenu({
  x,
  y,
  onDelete,
  onDuplicate,
  onSplit,
  onClose,
}: ClipContextMenuProps) {
  const { t } = useTranslation();

  const items: ContextMenuItem[] = [
    {
      id: 'duplicate',
      label: t.common.duplicate,
      icon: <Copy className="w-3.5 h-3.5" />,
      onSelect: onDuplicate,
    },
    ...(onSplit
      ? [
          {
            id: 'split',
            label: t.media_studio.split,
            icon: <Scissors className="w-3.5 h-3.5" />,
            onSelect: onSplit,
          },
        ]
      : []),
    {
      id: 'delete',
      label: t.common.delete,
      icon: <Trash2 className="w-3.5 h-3.5" />,
      danger: true,
      separatorBefore: true,
      onSelect: onDelete,
    },
  ];

  return (
    <ContextMenu
      x={x}
      y={y}
      onClose={onClose}
      items={items}
      widthClass="min-w-[140px]"
      zIndex={100}
    />
  );
}
