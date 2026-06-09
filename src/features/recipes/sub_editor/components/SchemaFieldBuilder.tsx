import { useTranslation } from '@/i18n/useTranslation';
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'framer-motion';
import { DragHandle } from '@/features/shared/components/display/DragHandle';
import { DropIndicator } from '@/features/shared/components/display/DropIndicator';

export interface SchemaField {
  key: string;
  type: string;
  label: string;
  default?: string;
}

const FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'textarea', 'json'];

interface SchemaFieldBuilderProps {
  fields: SchemaField[];
  onChange: (fields: SchemaField[]) => void;
}

export function SchemaFieldBuilder({ fields, onChange }: SchemaFieldBuilderProps) {
  const { t } = useTranslation();
  const rt = t.recipes;
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const addField = useCallback(() => {
    onChange([...fields, { key: '', type: 'text', label: '', default: '' }]);
  }, [fields, onChange]);

  const updateField = useCallback((index: number, patch: Partial<SchemaField>) => {
    onChange(fields.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }, [fields, onChange]);

  const removeField = useCallback((index: number) => {
    onChange(fields.filter((_, i) => i !== index));
  }, [fields, onChange]);

  const isReordering = draggingIndex !== null;

  useEffect(() => {
    if (isReordering) {
      document.body.dataset.dragActive = 'true';
      return () => { delete document.body.dataset.dragActive; };
    }
    return undefined;
  }, [isReordering]);

  return (
    <div
      className="space-y-2 drop-zone-illuminated rounded-card p-1 -m-1"
      data-dragging={isReordering ? 'true' : undefined}
    >
      <Reorder.Group
        axis="y"
        values={fields}
        onReorder={onChange}
        className="space-y-2"
      >
        <AnimatePresence initial={false}>
          {fields.map((field, index) => (
            <Reorder.Item
              key={`${index}-${field.key || 'new'}`}
              value={field}
              initial={{ opacity: 0, height: 0 }}
              animate={{
                opacity: isReordering && index !== draggingIndex ? 0.7 : 1,
                height: 'auto',
                scale: index === draggingIndex ? 0.98 : 1,
              }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              onDragStart={() => setDraggingIndex(index)}
              onDragEnd={() => setDraggingIndex(null)}
              className={`group relative flex items-center gap-2 rounded-card ${
                index === draggingIndex ? 'shadow-elevation-3 z-10' : ''
              }`}
            >
              {isReordering && index !== draggingIndex && (
                <DropIndicator layoutId={`schema-field-drop-${index}`} inset="1.5rem" className="-top-[5px]" />
              )}
              <DragHandle reveal="always" className="hover:text-muted-foreground" />

              <div className="flex-1 grid grid-cols-1 sm:grid-cols-[1fr_100px_1fr] gap-2">
                <input
                  type="text"
                  value={field.key}
                  onChange={(e) => updateField(index, { key: e.target.value })}
                  placeholder={t.recipes.schema.placeholders.key}
                  className="w-full rounded-card border border-border/60 bg-background/50 px-2.5 py-1.5 typo-code text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50 font-mono"
                />

                <select
                  value={field.type}
                  onChange={(e) => updateField(index, { type: e.target.value })}
                  className="w-full rounded-card border border-border/60 bg-background/50 px-2 py-1.5 typo-body text-foreground focus-visible:outline-none focus-visible:border-primary/50"
                >
                  {FIELD_TYPES.map((ft) => (
                    <option key={ft} value={ft}>{t.recipes.schema.field_types[ft as keyof typeof t.recipes.schema.field_types]}</option>
                  ))}
                </select>

                <input
                  type="text"
                  value={field.label}
                  onChange={(e) => updateField(index, { label: e.target.value })}
                  placeholder={t.recipes.schema.placeholders.label}
                  className="w-full rounded-card border border-border/60 bg-background/50 px-2.5 py-1.5 typo-body text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-primary/50"
                />
              </div>

              <button
                type="button"
                onClick={() => removeField(index)}
                // eslint-disable-next-line custom/no-hardcoded-jsx-text
                aria-label="Remove field"
                className="p-1 rounded-card text-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </Reorder.Item>
          ))}
        </AnimatePresence>
      </Reorder.Group>

      <motion.button
        type="button"
        onClick={addField}
        whileTap={{ scale: 0.97 }}
        className="flex items-center gap-1.5 typo-body text-foreground hover:text-foreground transition-colors px-1 py-1"
      >
        <Plus className="w-3.5 h-3.5" />
        {rt.add_field}
      </motion.button>
    </div>
  );
}
