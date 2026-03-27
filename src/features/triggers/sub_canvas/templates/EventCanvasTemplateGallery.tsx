import { useState } from 'react';
import { LayoutTemplate, X, ArrowRight } from 'lucide-react';
import { EVENT_CANVAS_TEMPLATES } from './eventCanvasTemplateData';
import type { EventCanvasTemplate } from './eventCanvasTemplateTypes';

interface Props {
  open: boolean;
  onClose: () => void;
  onAdopt: (template: EventCanvasTemplate) => void;
}

export function EventCanvasTemplateGallery({ open, onClose, onAdopt }: Props) {
  const [selected, setSelected] = useState<string | null>(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[80vh] bg-card rounded-2xl border border-primary/10 shadow-elevation-4 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-primary/5">
          <div className="flex items-center gap-2">
            <LayoutTemplate className="w-4 h-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">Canvas Templates</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-md hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {EVENT_CANVAS_TEMPLATES.map(t => (
              <button
                key={t.id}
                onClick={() => setSelected(t.id === selected ? null : t.id)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  selected === t.id
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                    : 'border-primary/10 hover:border-primary/20 bg-card/60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center bg-primary/5 ${t.color}`}>
                    <t.icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xs font-semibold text-foreground">{t.name}</h3>
                    <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{t.description}</p>
                    <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground/50">
                      <span>{t.nodes.filter(n => n.nodeType === 'event_source').length} sources</span>
                      <span>&middot;</span>
                      <span>{t.nodes.filter(n => n.nodeType === 'persona_consumer').length} personas</span>
                      <span>&middot;</span>
                      <span>{t.edges.length} connections</span>
                    </div>
                  </div>
                </div>

                {/* Tags */}
                <div className="flex flex-wrap gap-1 mt-2.5">
                  {t.tags.map(tag => (
                    <span key={tag} className="px-1.5 py-0.5 rounded text-[9px] bg-secondary/60 text-muted-foreground/60">
                      {tag}
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/5">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors"
          >
            Cancel
          </button>
          <button
            disabled={!selected}
            onClick={() => {
              const t = EVENT_CANVAS_TEMPLATES.find(t => t.id === selected);
              if (t) {
                onAdopt(t);
                onClose();
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Use Template
            <ArrowRight className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
