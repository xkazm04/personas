import React, { useState } from 'react';
import { Pencil } from 'lucide-react';
import type { DesignHighlight } from '@/lib/types/designTypes';

interface PromptSectionTabProps {
  title: string;
  icon: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  codeStyle?: boolean;
  viewMode?: boolean;
  highlights?: DesignHighlight[];
}

export function PromptSectionTab({
  title,
  icon,
  value,
  onChange,
  placeholder,
  codeStyle = false,
  viewMode = false,
  highlights,
}: PromptSectionTabProps) {
  const charCount = value.length;
  const [isEditing, setIsEditing] = useState(false);

  const showTextarea = !viewMode || isEditing;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/60">{icon}</span>
          <h3 className="text-sm font-mono text-muted-foreground/50 uppercase tracking-wider">
            {title}
          </h3>
        </div>
        {viewMode && (
          <button
            onClick={() => setIsEditing(!isEditing)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs text-muted-foreground/60 hover:text-foreground/80 bg-secondary/30 hover:bg-secondary/50 border border-border/30 rounded-lg transition-colors"
          >
            {isEditing ? (
              'Done'
            ) : (
              <>
                <Pencil className="w-3 h-3" />
                Edit
              </>
            )}
          </button>
        )}
      </div>

      {showTextarea ? (
        <div className="relative">
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={`w-full min-h-[300px] px-4 py-3 bg-background/50 border border-border/50 rounded-2xl text-foreground text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all placeholder-muted-foreground/30 ${
              codeStyle ? 'font-mono' : 'font-sans'
            }`}
            placeholder={placeholder}
            spellCheck={!codeStyle}
          />
          <div className="absolute bottom-3 right-4 text-xs text-muted-foreground/30 font-mono pointer-events-none">
            {charCount.toLocaleString()} chars
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {highlights && highlights.length > 0 && !isEditing && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {highlights.map((h, i) => (
                <div
                  key={i}
                  className="p-2.5 rounded-xl border border-primary/15 bg-secondary/30"
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-base">{h.icon}</span>
                    <span className="text-xs font-medium text-foreground/70">{h.category}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {h.items.map((item, j) => (
                      <li key={j} className="text-xs text-muted-foreground/60 pl-5 relative before:content-[''] before:absolute before:left-1.5 before:top-[7px] before:w-1 before:h-1 before:rounded-full before:bg-muted-foreground/30">
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div className="px-4 py-3 bg-background/50 border border-border/50 rounded-2xl min-h-[100px]">
            {value ? (
              <div className="text-sm text-foreground whitespace-pre-wrap">{value}</div>
            ) : (
              <p className="text-sm text-muted-foreground/30 italic">
                {placeholder || 'No content yet...'}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
