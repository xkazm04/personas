import { useRef, useState } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Upload, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  CATEGORY_OPTIONS,
  TRIGGER_OPTIONS,
  MIN_INSTRUCTION_LENGTH,
} from '../runner/designRunnerConstants';
import type { CustomProps } from './TemplateSourceTypes';

export function CustomSourceView({ cases, validCount, onAdd, onRemove, onUpdateCase, onFileUpload }: CustomProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showExample, setShowExample] = useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground/90">
          Define template use cases ({validCount} ready)
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
            className="px-3 py-1.5 text-sm rounded-xl border border-primary/15 hover:bg-secondary/50 text-muted-foreground/90 transition-colors flex items-center gap-1.5"
            title="Load from .txt or .md file"
          >
            <Upload className="w-3 h-3" />
            Load file
          </button>
          <button
            onClick={onAdd}
            className="px-3 py-1.5 text-sm rounded-xl border border-primary/15 hover:bg-secondary/50 text-muted-foreground/90 transition-colors flex items-center gap-1.5"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        </div>
      </div>

      <div className="max-h-[320px] overflow-y-auto space-y-3 pr-1">
        {cases.map((c, index) => {
          const instrLen = c.instruction.trim().length;
          const instrShort = instrLen > 0 && instrLen < MIN_INSTRUCTION_LENGTH;
          const nameMissing = c.instruction.trim().length > 0 && c.name.trim().length === 0;

          return (
            <div
              key={index}
              className="rounded-xl border border-primary/10 bg-secondary/10 p-3 space-y-2"
            >
              {/* Row 1: number + name + delete */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground/60 w-5 text-right flex-shrink-0 font-mono">
                  {index + 1}.
                </span>
                <input
                  type="text"
                  value={c.name}
                  onChange={(e) => onUpdateCase(index, 'name', e.target.value)}
                  placeholder="Template name (e.g. Gmail Smart Filter)"
                  className={`flex-1 px-3 py-1.5 text-sm bg-secondary/30 border rounded-xl text-foreground/80 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors ${
                    nameMissing ? 'border-amber-500/30' : 'border-primary/10'
                  }`}
                />
                {cases.length > 1 && (
                  <button
                    onClick={() => onRemove(index)}
                    className="p-1 rounded hover:bg-red-500/10 text-muted-foreground/60 hover:text-red-400 transition-colors flex-shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Row 2: instruction */}
              <div className="ml-8">
                <textarea
                  value={c.instruction}
                  onChange={(e) => onUpdateCase(index, 'instruction', e.target.value)}
                  placeholder="Describe what this persona should do, which services to integrate, and what triggers should activate it..."
                  rows={3}
                  className={`w-full px-3 py-2 text-sm bg-secondary/30 border rounded-xl text-foreground/80 placeholder:text-muted-foreground/50 resize-none focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors ${
                    instrShort ? 'border-amber-500/30' : 'border-primary/10'
                  }`}
                />
                {instrShort && (
                  <p className="text-sm text-amber-400/80 mt-0.5">
                    {instrLen}/{MIN_INSTRUCTION_LENGTH} characters minimum
                  </p>
                )}
              </div>

              {/* Row 3: metadata dropdowns */}
              <div className="ml-8 flex items-center gap-2 flex-wrap">
                <select
                  value={c.category ?? ''}
                  onChange={(e) => onUpdateCase(index, 'category', e.target.value)}
                  className="px-2 py-1 text-sm bg-secondary/30 border border-primary/10 rounded-lg text-muted-foreground/80 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
                >
                  <option value="">Category...</option>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <select
                  value={c.trigger ?? ''}
                  onChange={(e) => onUpdateCase(index, 'trigger', e.target.value)}
                  className="px-2 py-1 text-sm bg-secondary/30 border border-primary/10 rounded-lg text-muted-foreground/80 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
                >
                  <option value="">Trigger...</option>
                  {TRIGGER_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={c.tools ?? ''}
                  onChange={(e) => onUpdateCase(index, 'tools', e.target.value)}
                  placeholder="Connectors (e.g. gmail, slack)"
                  className="flex-1 min-w-[160px] px-2 py-1 text-sm bg-secondary/30 border border-primary/10 rounded-lg text-foreground/80 placeholder:text-muted-foreground/50 focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Guidance + example */}
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground/70">
          More detail = better results. Include services, triggers, and expected behavior.
        </p>
        <button
          onClick={() => setShowExample((v) => !v)}
          className="text-sm text-violet-400/70 hover:text-violet-400 transition-colors flex items-center gap-1"
        >
          {showExample ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showExample ? 'Hide example' : 'Show example'}
        </button>
        {showExample && (
          <div className="text-sm text-muted-foreground/60 bg-secondary/20 border border-primary/5 rounded-lg p-3 mt-1">
            <p className="font-medium text-muted-foreground/80 mb-1">Example: Gmail Smart Filter</p>
            <p className="italic">
              &quot;Create an agent that monitors Gmail for important emails, categorizes them by
              sender and urgency, applies labels, and forwards urgent ones to Slack. Use polling
              trigger with gmail and slack connectors.&quot;
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
