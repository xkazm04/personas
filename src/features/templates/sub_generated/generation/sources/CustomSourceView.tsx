import { useRef, useState } from 'react';
import { Upload, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
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
        <p className="typo-body text-foreground">
          {t.templates.generation.custom_count.replace('{count}', String(validCount))}
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
            className="px-3 py-1.5 typo-body rounded-modal border border-primary/15 hover:bg-secondary/50 text-foreground transition-colors flex items-center gap-1.5"
            title={t.templates.generation.custom_load_file_title}
          >
            <Upload className="w-3 h-3" />
            {t.templates.generation.custom_load_file}
          </button>
          <button
            onClick={onAdd}
            className="px-3 py-1.5 typo-body rounded-modal border border-primary/15 hover:bg-secondary/50 text-foreground transition-colors flex items-center gap-1.5"
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
              className="rounded-modal border border-primary/10 bg-secondary/10 p-3 space-y-2"
            >
              {/* Row 1: number + name + delete */}
              <div className="flex items-center gap-2">
                <span className="typo-code text-foreground w-5 text-right flex-shrink-0 font-mono">
                  {index + 1}.
                </span>
                <input
                  type="text"
                  value={c.name}
                  onChange={(e) => onUpdateCase(index, 'name', e.target.value)}
                  placeholder={t.templates.generation.custom_case_name_placeholder}
                  className={`flex-1 px-3 py-1.5 typo-body bg-secondary/30 border rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors ${
                    nameMissing ? 'border-amber-500/30' : 'border-primary/10'
                  }`}
                />
                {cases.length > 1 && (
                  <button
                    onClick={() => onRemove(index)}
                    className="p-1 rounded hover:bg-red-500/10 text-foreground hover:text-red-400 transition-colors flex-shrink-0"
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
                  placeholder={t.templates.generation.custom_instruction_placeholder}
                  rows={3}
                  className={`w-full px-3 py-2 typo-body bg-secondary/30 border rounded-modal text-foreground placeholder:text-foreground resize-none focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors ${
                    instrShort ? 'border-amber-500/30' : 'border-primary/10'
                  }`}
                />
                {instrShort && (
                  <p className="typo-body text-amber-400/80 mt-0.5">
                    {t.templates.generation.custom_short_instruction.replace('{current}', String(instrLen)).replace('{min}', String(MIN_INSTRUCTION_LENGTH))}
                  </p>
                )}
              </div>

              {/* Row 3: metadata dropdowns */}
              <div className="ml-8 flex items-center gap-2 flex-wrap">
                <select
                  value={c.category ?? ''}
                  onChange={(e) => onUpdateCase(index, 'category', e.target.value)}
                  className="px-2 py-1 typo-body bg-secondary/30 border border-primary/10 rounded-card text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
                >
                  <option value="">{t.templates.generation.custom_category_default}</option>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <select
                  value={c.trigger ?? ''}
                  onChange={(e) => onUpdateCase(index, 'trigger', e.target.value)}
                  className="px-2 py-1 typo-body bg-secondary/30 border border-primary/10 rounded-card text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
                >
                  <option value="">{t.templates.generation.custom_trigger_default}</option>
                  {TRIGGER_OPTIONS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={c.tools ?? ''}
                  onChange={(e) => onUpdateCase(index, 'tools', e.target.value)}
                  placeholder={t.templates.generation.custom_connectors_placeholder}
                  className="flex-1 min-w-[160px] px-2 py-1 typo-body bg-secondary/30 border border-primary/10 rounded-card text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-violet-500/30 transition-colors"
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Guidance + example */}
      <div className="space-y-1">
        <p className="typo-body text-foreground">
          {t.templates.generation.custom_detail_hint}
        </p>
        <button
          onClick={() => setShowExample((v) => !v)}
          className="typo-body text-violet-400/70 hover:text-violet-400 transition-colors flex items-center gap-1"
        >
          {showExample ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showExample ? 'Hide example' : 'Show example'}
        </button>
        {showExample && (
          <div className="typo-body text-foreground bg-secondary/20 border border-primary/5 rounded-card p-3 mt-1">
            <p className="font-medium text-foreground mb-1">{t.templates.generation.custom_example_title}</p>
            <p className="italic">
              {t.templates.generation.custom_example_body}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
