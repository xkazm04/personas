import { useRef, useState } from 'react';
import { Upload, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import {
  CATEGORY_OPTIONS,
  TRIGGER_OPTIONS,
  MIN_INSTRUCTION_LENGTH,
} from '../runner/designRunnerConstants';
import type { CustomProps } from './TemplateSourceTypes';
import Button from '@/features/shared/components/buttons/Button';

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
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            variant="secondary"
            size="sm"
            tooltip={t.templates.generation.custom_load_file_title}
            icon={<Upload className="w-3 h-3" />}
          >
            {t.templates.generation.custom_load_file}
          </Button>
          <Button
            type="button"
            onClick={onAdd}
            variant="secondary"
            size="sm"
            icon={<Plus className="w-3 h-3" />}
          >
            Add
          </Button>
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
              className="rounded-modal border border-hair bg-secondary/10 p-3 space-y-2"
            >
              {/* Row 1: number + name + delete */}
              <div className="flex items-center gap-2">
                <span className="typo-code text-foreground w-5 text-right flex-shrink-0">
                  {index + 1}.
                </span>
                <input
                  type="text"
                  value={c.name}
                  onChange={(e) => onUpdateCase(index, 'name', e.target.value)}
                  placeholder={t.templates.generation.custom_case_name_placeholder}
                  className={`flex-1 px-3 py-1.5 typo-body bg-surface-1 border rounded-modal text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-role-agent/30 transition-colors ${
                    nameMissing ? 'border-status-warning/30' : 'border-hair'
                  }`}
                />
                {cases.length > 1 && (
                  <Button
                    type="button"
                    onClick={() => onRemove(index)}
                    variant="ghost"
                    size="icon-sm"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>

              {/* Row 2: instruction */}
              <div className="ml-8">
                <textarea
                  value={c.instruction}
                  onChange={(e) => onUpdateCase(index, 'instruction', e.target.value)}
                  placeholder={t.templates.generation.custom_instruction_placeholder}
                  rows={3}
                  className={`w-full px-3 py-2 typo-body bg-surface-1 border rounded-modal text-foreground placeholder:text-foreground resize-none focus-visible:outline-none focus-visible:border-role-agent/30 transition-colors ${
                    instrShort ? 'border-status-warning/30' : 'border-hair'
                  }`}
                />
                {instrShort && (
                  <p className="typo-body text-status-warning/80 mt-0.5">
                    {t.templates.generation.custom_short_instruction.replace('{current}', String(instrLen)).replace('{min}', String(MIN_INSTRUCTION_LENGTH))}
                  </p>
                )}
              </div>

              {/* Row 3: metadata dropdowns */}
              <div className="ml-8 flex items-center gap-2 flex-wrap">
                <select
                  value={c.category ?? ''}
                  onChange={(e) => onUpdateCase(index, 'category', e.target.value)}
                  className="px-2 py-1 typo-body bg-surface-1 border border-hair rounded-card text-foreground focus-visible:outline-none focus-visible:border-role-agent/30 transition-colors"
                >
                  <option value="">{t.templates.generation.custom_category_default}</option>
                  {CATEGORY_OPTIONS.map((cat) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
                <select
                  value={c.trigger ?? ''}
                  onChange={(e) => onUpdateCase(index, 'trigger', e.target.value)}
                  className="px-2 py-1 typo-body bg-surface-1 border border-hair rounded-card text-foreground focus-visible:outline-none focus-visible:border-role-agent/30 transition-colors"
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
                  className="flex-1 min-w-[160px] px-2 py-1 typo-body bg-surface-1 border border-hair rounded-card text-foreground placeholder:text-foreground focus-visible:outline-none focus-visible:border-role-agent/30 transition-colors"
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
        <Button
          type="button"
          onClick={() => setShowExample((v) => !v)}
          variant="ghost"
          size="sm"
          icon={showExample ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        >
          {showExample ? 'Hide example' : 'Show example'}
        </Button>
        {showExample && (
          <div className="typo-body text-foreground bg-surface-1 border border-hair rounded-card p-3 mt-1">
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
