// Header row for a single UC card — checkbox, title, action buttons
// (Info, Preview, Test, Mode toggle). Pencil icon flips into edit mode;
// check icon reverts to view mode.

import { AnimatePresence, motion } from 'framer-motion';
import {
  Check,
  CheckCircle2,
  Eye,
  Info,
  Loader2,
  Pencil,
  Play,
} from 'lucide-react';
import { FADE } from './ucPickerTypes';

interface Props {
  ucName: string;
  on: boolean;
  descExpanded: boolean;
  canPreview: boolean;
  cardMode: 'view' | 'edit';
  status: 'idle' | 'running' | 'done';
  onToggle: () => void;
  onToggleDesc: () => void;
  onToggleMode: () => void;
  onPreview: () => void;
  onRunTest: () => void;
}

export function UcCardHeader({
  ucName,
  on,
  descExpanded,
  canPreview,
  cardMode,
  status,
  onToggle,
  onToggleDesc,
  onToggleMode,
  onPreview,
  onRunTest,
}: Props) {
  return (
    <div className="flex items-start gap-4 px-5 py-4 border-b border-border/60">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={on}
        className={`focus-ring flex-shrink-0 mt-1.5 w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
          on
            ? 'bg-primary ring-1 ring-primary shadow-elevation-1'
            : 'bg-transparent ring-1 ring-foreground/25 hover:ring-foreground/40'
        }`}
      >
        {on && <Check className="w-4 h-4 text-background" strokeWidth={3} />}
      </button>
      <h4
        className={`flex-1 min-w-0 text-3xl font-semibold leading-tight tracking-tight truncate ${
          on ? 'text-foreground' : 'text-foreground/70'
        }`}
      >
        {ucName}
      </h4>
      {on && (
        <div className="flex items-center gap-2 flex-shrink-0 pt-0.5">
          <button
            type="button"
            onClick={onToggleMode}
            aria-pressed={cardMode === 'edit'}
            title={cardMode === 'view' ? 'Edit configuration' : 'Done editing'}
            className={`focus-ring w-10 h-10 rounded-full ring-1 flex items-center justify-center transition-colors ${
              cardMode === 'edit'
                ? 'ring-primary/60 bg-primary/15 text-primary shadow-elevation-1'
                : 'ring-border bg-secondary/40 text-foreground/80 hover:bg-secondary/70 hover:text-foreground'
            }`}
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={cardMode}
                initial={{ opacity: 0, rotate: -30 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 30 }}
                transition={{ duration: 0.18 }}
                className="inline-flex"
              >
                {cardMode === 'view' ? <Pencil className="w-5 h-5" /> : <Check className="w-5 h-5" strokeWidth={3} />}
              </motion.span>
            </AnimatePresence>
          </button>
          <button
            type="button"
            onClick={onToggleDesc}
            aria-pressed={descExpanded}
            className={`focus-ring w-10 h-10 rounded-full ring-1 flex items-center justify-center transition-colors ${
              descExpanded
                ? 'ring-primary/60 bg-primary/15 text-primary'
                : 'ring-border bg-secondary/40 text-foreground/80 hover:bg-secondary/70 hover:text-foreground'
            }`}
          >
            <Info className="w-5 h-5" />
          </button>
          <AnimatePresence initial={false}>
            {canPreview && (
              <motion.button
                key="preview"
                type="button"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={FADE}
                onClick={onPreview}
                className="focus-ring w-10 h-10 rounded-full ring-1 ring-border bg-secondary/40 text-foreground/80 hover:bg-secondary/70 hover:text-foreground flex items-center justify-center transition-colors"
              >
                <Eye className="w-5 h-5" />
              </motion.button>
            )}
          </AnimatePresence>
          <button
            type="button"
            onClick={onRunTest}
            disabled={status === 'running'}
            className="focus-ring w-10 h-10 rounded-full ring-1 ring-primary/60 bg-primary/20 text-primary hover:bg-primary/30 hover:ring-primary/70 disabled:opacity-60 flex items-center justify-center shadow-elevation-1 transition-all"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={status}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={{ duration: 0.14 }}
                className="inline-flex"
              >
                {status === 'running' ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : status === 'done' ? (
                  <CheckCircle2 className="w-5 h-5 text-status-success" />
                ) : (
                  <Play className="w-5 h-5" />
                )}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      )}
    </div>
  );
}
