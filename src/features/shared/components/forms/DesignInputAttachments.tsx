import { X, File } from 'lucide-react';
import type { DesignFileType, DesignFile } from '@/lib/types/frontendTypes';
import { FILE_TYPE_ICONS, FILE_TYPE_LABELS } from './designInputHelpers';
import { useTranslation } from '@/i18n/useTranslation';

interface TypeSelectorProps {
  pendingFile: { name: string; content: string };
  onConfirm: (type: DesignFileType) => void;
  onCancel: () => void;
}

export function TypeSelectorModal({ pendingFile, onConfirm, onCancel }: TypeSelectorProps) {
  return (
    <div className="bg-secondary/60 backdrop-blur-sm border border-primary/15 rounded-xl p-3 space-y-2">
      <p className="typo-body text-foreground">
        Classify <span className="font-medium text-foreground/90">{pendingFile.name}</span>:
      </p>
      <div className="flex flex-wrap gap-1.5">
        {(Object.keys(FILE_TYPE_LABELS) as DesignFileType[]).map((type) => {
          const Icon = FILE_TYPE_ICONS[type];
          return (
            <button
              key={type}
              onClick={() => onConfirm(type)}
              className="flex items-center gap-1.5 px-2.5 py-1 bg-background/50 border border-primary/15 rounded-xl typo-body text-foreground/90 hover:border-primary/30 hover:bg-primary/5 transition-all"
            >
              <Icon className="w-3 h-3" />
              {FILE_TYPE_LABELS[type]}
            </button>
          );
        })}
        <button
          onClick={onCancel}
          className="px-2.5 py-1 typo-body text-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

interface AttachedFilesRowProps {
  files: DesignFile[];
  onRemove: (index: number) => void;
}

export function AttachedFilesRow({ files, onRemove }: AttachedFilesRowProps) {
  const { t } = useTranslation();
  if (files.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((file, index) => {
        const Icon = FILE_TYPE_ICONS[file.type] || File;
        return (
          <div
            key={`${file.name}-${index}`}
            className="flex items-center gap-1.5 bg-secondary/50 border border-primary/10 rounded-full px-3 py-1 typo-body group"
          >
            <Icon className="w-3 h-3 text-foreground" />
            <span className="text-foreground/90 max-w-[120px] truncate">{file.name}</span>
            <span className="text-foreground">{FILE_TYPE_LABELS[file.type]}</span>
            <button
              onClick={() => onRemove(index)}
              className="ml-0.5 text-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
              title={t.shared.forms_extra.remove_file}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

interface ReferencesTextareaProps {
  references: string[];
  onChange: (value: string) => void;
  disabled: boolean;
}

export function ReferencesTextarea({ references, onChange, disabled }: ReferencesTextareaProps) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1">
      <label className="typo-body text-foreground px-1">{t.shared.forms_extra.references}</label>
      <textarea
        value={references.join('\n')}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={t.shared.forms_extra.references_placeholder}
        rows={3}
        className="w-full bg-background/50 border border-primary/15 rounded-xl px-3 py-2 typo-code text-foreground resize-y focus-ring focus-visible:border-primary/40 transition-all placeholder-muted-foreground/30"
      />
    </div>
  );
}
