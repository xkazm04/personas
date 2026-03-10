import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { QUICK_MODELS } from './quickModelUtils';

interface ModelSubmenuProps {
  subMenuRef: React.RefObject<HTMLDivElement | null>;
  subPos: { left: number; top: number };
  activeModel: string;
  onModelSwitch: (value: string) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}

export function ModelSubmenu({
  subMenuRef,
  subPos,
  activeModel,
  onModelSwitch,
  onMouseEnter,
  onMouseLeave,
}: ModelSubmenuProps) {
  return (
    <motion.div
      ref={subMenuRef}
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.1 }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-101 w-48 py-1 bg-background/95 backdrop-blur-md border border-primary/20 rounded-lg shadow-xl"
      style={{ left: subPos.left, top: subPos.top }}
      role="menu"
      aria-label="Quick model selection"
      data-menu-scope="sub"
    >
      {QUICK_MODELS.map((model, i) => {
        const isActive = activeModel === model.value;
        const prevProvider = i > 0 ? QUICK_MODELS[i - 1]!.provider : null;
        const showDivider = prevProvider !== null && prevProvider !== model.provider;

        return (
          <div key={model.value || '__opus__'}>
            {showDivider && <div className="my-1 border-t border-primary/10" />}
            <button
              onClick={() => onModelSwitch(model.value)}
              className={`w-full px-3 py-1.5 text-sm text-left flex items-center gap-2 transition-colors ${
                isActive
                  ? 'bg-primary/10 text-foreground/90'
                  : 'hover:bg-secondary/60 text-foreground/80'
              }`}
              role="menuitem"
              data-menuitem="true"
            >
              {isActive ? (
                <Check className="w-3 h-3 text-primary shrink-0" />
              ) : (
                <span className="w-3 h-3 shrink-0" />
              )}
              <span className="flex-1 truncate">{model.label}</span>
              <span className="text-sm text-muted-foreground/50">{model.provider}</span>
            </button>
          </div>
        );
      })}
    </motion.div>
  );
}
