import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Terminal, ChevronDown } from "lucide-react";

interface GlyphActivityStripProps {
  lines: string[];
}

export function GlyphActivityStrip({ lines }: GlyphActivityStripProps) {
  const [expanded, setExpanded] = useState(false);
  if (lines.length === 0) return null;
  const latest = lines[lines.length - 1];
  return (
    <div className="w-full max-w-xl">
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-modal bg-foreground/[0.03] border border-border/20 hover:border-border/40 text-left transition-colors"
      >
        <Terminal className="w-3.5 h-3.5 text-foreground shrink-0" />
        <span className="flex-1 truncate typo-caption text-foreground font-mono">
          {latest}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-2 p-3 rounded-modal bg-black/20 border border-border/20 max-h-48 overflow-y-auto">
              {lines.slice(-100).map((line, i) => (
                <div key={i} className="typo-caption font-mono text-foreground leading-snug whitespace-pre-wrap break-words">
                  {line}
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
