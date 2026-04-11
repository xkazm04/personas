import { Trash2, GripVertical } from 'lucide-react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { useTranslation } from '@/i18n/useTranslation';
import type { BuilderUseCase } from '../../steps/builder/types';
import { TriggerPopover } from '../triggers/TriggerPopover';

interface UseCaseCardContentProps {
  useCase: BuilderUseCase;
  index: number;
  onUpdate: (updates: Partial<BuilderUseCase>) => void;
  onRemove: () => void;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}

export function UseCaseCardContent({
  useCase,
  index,
  onUpdate,
  onRemove,
  dragHandleProps,
  isDragging,
}: UseCaseCardContentProps) {
  const { t } = useTranslation();
  return (
    <div
      className={`border border-primary/20 rounded-xl bg-secondary/20 ${
        isDragging ? 'opacity-40 border-dashed border-primary/30' : ''
      }`}
    >
      {/* Header row: drag handle + index + title + remove */}
      <div className="flex items-center gap-1 px-3 py-2">
        <button
          type="button"
          className="p-0.5 cursor-grab active:cursor-grabbing text-muted-foreground/35 hover:text-muted-foreground/65 transition-colors shrink-0 touch-none"
          {...dragHandleProps}
        >
          <GripVertical className="w-3.5 h-3.5" />
        </button>
        <span className="text-sm text-muted-foreground/55 font-mono w-5 shrink-0">#{index + 1}</span>
        <input
          type="text"
          value={useCase.title}
          onChange={(e) => onUpdate({ title: e.target.value })}
          placeholder={t.agents.use_case.title_placeholder}
          className="flex-1 min-w-0 bg-transparent text-sm font-medium text-foreground placeholder-muted-foreground/40 focus-visible:outline-none"
        />
        <button
          type="button"
          onClick={onRemove}
          className="p-1 text-muted-foreground/50 hover:text-red-400 transition-colors shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Description row with trigger icon on the left */}
      <div className="flex items-start gap-2 px-3 pb-2.5">
        <div className="mt-1 shrink-0">
          <TriggerPopover
            value={useCase.trigger}
            onChange={(preset) => onUpdate({ trigger: preset })}
          />
        </div>
        <textarea
          value={useCase.description}
          onChange={(e) => onUpdate({ description: e.target.value })}
          placeholder={t.agents.use_case.description_placeholder}
          rows={1}
          className="flex-1 min-w-0 px-2 py-1.5 bg-secondary/30 border border-primary/10 rounded-lg text-sm text-foreground placeholder-muted-foreground/40 focus-ring resize-none"
        />
      </div>
    </div>
  );
}

export function DraggableUseCaseCard({
  useCase,
  index,
  onUpdate,
  onRemove,
}: {
  useCase: BuilderUseCase;
  index: number;
  onUpdate: (updates: Partial<BuilderUseCase>) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    isDragging,
  } = useDraggable({
    id: useCase.id,
    data: { index },
  });

  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `drop-${useCase.id}`,
    data: { index },
  });

  return (
    <div
      ref={(node) => {
        setDragRef(node);
        setDropRef(node);
      }}
      className={`animate-fade-in overflow-hidden ${isOver && !isDragging ? 'ring-1 ring-primary/30 rounded-xl' : ''}`}
      {...attributes}
    >
      <UseCaseCardContent
        useCase={useCase}
        index={index}
        onUpdate={onUpdate}
        onRemove={onRemove}
        dragHandleProps={listeners}
        isDragging={isDragging}
      />
    </div>
  );
}
