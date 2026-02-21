import { useState } from 'react';
import { Eye, Pencil } from 'lucide-react';
import { MarkdownRenderer } from '@/features/shared/components/MarkdownRenderer';

interface SectionEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}

export function SectionEditor({ value, onChange, label, placeholder, disabled }: SectionEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header with label and toggle */}
      <div className="flex items-center justify-between px-1 pb-2 flex-shrink-0">
        <span className="text-xs font-medium text-foreground/60">{label}</span>
        <div className="flex gap-0.5 p-0.5 rounded-lg bg-secondary/30 border border-primary/10">
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-colors ${
              mode === 'edit'
                ? 'bg-primary/15 text-foreground/80 font-medium'
                : 'text-muted-foreground/50 hover:text-muted-foreground/70'
            }`}
          >
            <Pencil className="w-3 h-3" />
            Edit
          </button>
          <button
            onClick={() => setMode('preview')}
            className={`flex items-center gap-1 px-2 py-1 text-[11px] rounded-md transition-colors ${
              mode === 'preview'
                ? 'bg-primary/15 text-foreground/80 font-medium'
                : 'text-muted-foreground/50 hover:text-muted-foreground/70'
            }`}
          >
            <Eye className="w-3 h-3" />
            Preview
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 rounded-xl border border-primary/15 overflow-hidden">
        {mode === 'edit' ? (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            placeholder={placeholder}
            className="w-full h-full px-4 py-3 bg-background/50 text-sm text-foreground font-mono leading-relaxed placeholder-muted-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
          />
        ) : (
          <div className="h-full overflow-y-auto px-4 py-3 bg-background/30">
            {value.trim() ? (
              <MarkdownRenderer content={value} />
            ) : (
              <p className="text-sm text-muted-foreground/30 italic">No content to preview</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
