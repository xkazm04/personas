import { Check } from 'lucide-react';
import { useTemplateMotion } from '@/features/templates/animationPresets';

export function SelectionCheckbox({ checked, onChange, id }: { checked: boolean; onChange: () => void; id?: string }) {
  const { motion: MOTION } = useTemplateMotion();

  return (
    <span
      role="presentation"
      className={`w-4 h-4 rounded-lg flex items-center justify-center flex-shrink-0 transition-all ${MOTION.snappy.css} cursor-pointer ${
        checked
          ? 'bg-violet-500 border border-violet-500'
          : 'bg-secondary/40 border border-primary/20 hover:border-primary/40'
      }`}
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={() => onChange()}
        onClick={(e) => e.stopPropagation()}
        className="sr-only"
      />
      {checked && (
          <div className="animate-fade-slide-in"
          >
            <Check className="w-3 h-3 text-foreground" strokeWidth={3} />
          </div>
        )}
    </span>
  );
}
