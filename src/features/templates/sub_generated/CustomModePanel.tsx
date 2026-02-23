import React, { useRef } from 'react';
import { Upload, Plus, Trash2 } from 'lucide-react';

interface CustomModePanelProps {
  instructions: string[];
  validCount: number;
  onAdd: () => void;
  onRemove: (index: number) => void;
  onUpdate: (index: number, value: string) => void;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function CustomModePanel({
  instructions,
  validCount,
  onAdd,
  onRemove,
  onUpdate,
  onFileUpload,
}: CustomModePanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground/90">
          Enter use case instructions ({validCount} valid)
        </p>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            onChange={onFileUpload}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-3 py-1.5 text-sm rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/90 transition-colors flex items-center gap-1.5"
            title="Load from .txt or .md file (lines starting with '-')"
          >
            <Upload className="w-3 h-3" />
            Load file
          </button>
          <button
            onClick={onAdd}
            className="px-3 py-1.5 text-sm rounded-lg border border-primary/15 hover:bg-secondary/50 text-muted-foreground/90 transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>

      <div className="max-h-[200px] overflow-y-auto space-y-2 pr-1">
        {instructions.map((instruction, index) => (
          <div key={index} className="flex items-start gap-2">
            <span className="text-sm text-muted-foreground/80 mt-2.5 w-5 text-right flex-shrink-0">
              {index + 1}.
            </span>
            <textarea
              value={instruction}
              onChange={(e) => onUpdate(index, e.target.value)}
              placeholder="Describe a persona use case to test..."
              rows={2}
              className="flex-1 px-3 py-2 text-sm bg-secondary/30 border border-primary/10 rounded-lg text-foreground/80 placeholder:text-muted-foreground/80 resize-none focus:outline-none focus:border-violet-500/30 transition-colors"
            />
            {instructions.length > 1 && (
              <button
                onClick={() => onRemove(index)}
                className="mt-2 p-1 rounded hover:bg-red-500/10 text-muted-foreground/80 hover:text-red-400 transition-colors flex-shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <p className="text-sm text-muted-foreground/80">
        Tip: Upload a .txt or .md file with bullet points (lines starting with &apos;-&apos;) to load multiple cases at once
      </p>
    </div>
  );
}
