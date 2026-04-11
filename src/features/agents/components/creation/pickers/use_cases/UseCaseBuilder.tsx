import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  useSensor,
  useSensors,
  PointerSensor,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import type { BuilderUseCase } from '../../steps/builder/types';
import { UseCaseCardContent, DraggableUseCaseCard } from './UseCaseCard';

interface UseCaseBuilderProps {
  useCases: BuilderUseCase[];
  onAdd: () => void;
  onUpdate: (id: string, updates: Partial<BuilderUseCase>) => void;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

export function UseCaseBuilder({ useCases, onAdd, onUpdate, onRemove, onReorder }: UseCaseBuilderProps) {
  const { t } = useTranslation();
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const fromIndex = active.data.current?.index as number | undefined;
    const toIndex = over.data.current?.index as number | undefined;

    if (fromIndex != null && toIndex != null && fromIndex !== toIndex) {
      onReorder(fromIndex, toIndex);
    }
  };

  const activeUseCase = activeId ? useCases.find((uc) => uc.id === activeId) : null;
  const activeIndex = activeId ? useCases.findIndex((uc) => uc.id === activeId) : -1;

  return (
    <div className="space-y-2">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <AnimatePresence mode="popLayout">
          {useCases.map((uc, i) => (
            <DraggableUseCaseCard
              key={uc.id}
              useCase={uc}
              index={i}
              onUpdate={(updates) => onUpdate(uc.id, updates)}
              onRemove={() => onRemove(uc.id)}
            />
          ))}
        </AnimatePresence>

        <DragOverlay>
          {activeUseCase && (
            <motion.div
              initial={{ rotate: 0, scale: 1 }}
              animate={{ rotate: 1.5, scale: 1.02 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="opacity-85 pointer-events-none"
            >
              <UseCaseCardContent
                useCase={activeUseCase}
                index={activeIndex}
                onUpdate={() => {}}
                onRemove={() => {}}
              />
            </motion.div>
          )}
        </DragOverlay>
      </DndContext>

      <button
        type="button"
        onClick={onAdd}
        className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-muted-foreground/70 border border-dashed border-primary/20 rounded-xl hover:bg-secondary/30 hover:text-foreground/80 transition-colors"
      >
        <Plus className="w-3.5 h-3.5" />
        {t.agents.use_case.add}
      </button>
    </div>
  );
}
