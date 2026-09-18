import { useId, useState } from 'react';
import { AlertTriangle, FolderOpen, Loader2 } from 'lucide-react';
import { open } from '@tauri-apps/plugin-dialog';
import { useTranslation } from '@/i18n/useTranslation';
import { silentCatch } from '@/lib/silentCatch';
import Button from '@/features/shared/components/buttons/Button';
import { readRecentDirectories, rememberRecentDirectory } from './directoryRecents';
import { mergeFieldInputProps } from './fieldInputProps';
import type { FormFieldInputProps } from './FormField';


interface DirectoryPickerInputProps extends Partial<FormFieldInputProps> {
  value: string;
  onChange: (path: string) => void;
  placeholder?: string;
  className?: string;
  /**
   * Namespace for the remembered paths. Fields that pick genuinely different
   * kinds of folder should pass their own scope; everything else shares the
   * default, because "the project folder I chose last time" is usually the
   * same answer across the app.
   */
  recentsScope?: string;
  /** Opt out of the recent-path chips (the field itself is unchanged). */
  showRecents?: boolean;
}

/**
 * @catalog Directory path field with a native browse button, recent-path chips
 * and an inline failure notice. A dismissed dialog stays silent; a dialog that
 * FAILS says so and offers Retry, instead of leaving the field unexplained.
 */
export function DirectoryPickerInput({
  value,
  onChange,
  placeholder: placeholderProp,
  className,
  recentsScope = 'default',
  showRecents = true,
  // Spread straight from a wrapping FormField's render-prop:
  //   <FormField label error>{(p) => <DirectoryPickerInput {...p} … />}</FormField>
  ...fieldProps
}: DirectoryPickerInputProps) {
  const { t } = useTranslation();
  const placeholder = placeholderProp ?? t.common.select_directory;
  const [browsing, setBrowsing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [recents, setRecents] = useState<string[]>(() => readRecentDirectories(recentsScope));
  const errorId = useId();

  const handleBrowse = async () => {
    setBrowsing(true);
    setFailed(false);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t.common.select_output_directory,
      });
      // A dismissed dialog resolves null. That is an answer, not a fault, and
      // it stays silent - only a THROW means the picker could not run.
      if (selected && typeof selected === 'string') {
        onChange(selected);
        setRecents(rememberRecentDirectory(recentsScope, selected));
      }
    } catch (err) {
      silentCatch('features/shared/components/forms/DirectoryPickerInput:catch1')(err);
      setFailed(true);
    } finally {
      setBrowsing(false);
    }
  };

  const chips = showRecents ? recents.filter((p) => p !== value) : [];

  return (
    <div className={`flex flex-col gap-1.5 max-w-lg ${className ?? ''}`}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-foreground pointer-events-none" />
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            {...mergeFieldInputProps(fieldProps, {
              invalid: failed,
              describedBy: failed ? errorId : undefined,
            })}
            className={`w-full pl-9 pr-3 py-1.5 typo-body rounded-lg border bg-white/[0.03] text-foreground placeholder:text-foreground focus:outline-none focus:bg-white/[0.05] transition-all ${
              failed ? 'border-status-error/50 focus:border-status-error' : 'border-white/[0.08] focus:border-primary/30'
            }`}
          />
        </div>
        <button
          type="button"
          onClick={handleBrowse}
          disabled={browsing}
          className="flex items-center gap-1.5 px-3 py-1.5 typo-body rounded-lg border border-primary/15 bg-background/80 text-foreground hover:border-primary/25 hover:text-foreground transition-all disabled:opacity-50"
        >
          {browsing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <FolderOpen className="w-3.5 h-3.5" />
          )}
          {t.common.browse}
        </button>
      </div>

      {failed && (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 typo-caption text-status-error">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t.common.directory_browse_failed}</span>
          <Button variant="link" size="sm" onClick={handleBrowse} disabled={browsing}>
            {t.common.retry}
          </Button>
        </p>
      )}

      {chips.length > 0 && (
        <div role="group" aria-label={t.common.recent_directories} className="flex flex-wrap gap-1.5">
          {chips.map((path) => (
            <button
              key={path}
              type="button"
              onClick={() => onChange(path)}
              className="max-w-[16rem] truncate rounded-interactive border border-border bg-secondary/40 px-2 py-0.5 typo-caption text-foreground transition-colors hover:border-primary/30 hover:bg-secondary/60"
            >
              {path}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
