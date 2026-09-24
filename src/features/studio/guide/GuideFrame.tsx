import { useEffect, useRef, useState, type ReactNode } from 'react';
import { RotateCcw, X } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { guideStrings } from './guideCopy';
import StudioVisionStart from '../StudioVisionStart';
import StudioVersions from '../StudioVersions';
import { useStudioStore } from '../studioStore';
import type { StudioPreviewState } from '../useStudioPreview';

// The main frame: the app being built, wrapped and given full focus (contest
// A/1). A thin header says what the frame shows in plain words; the address,
// reload and snapshots sit at its right edge. Its gradient hairline brightens
// while Athena works.
export default function GuideFrame({
  preview,
  blueprint,
  vision,
  working,
  submitting,
  onCreate,
  onCancelCreate,
  children,
}: {
  preview: StudioPreviewState;
  blueprint: boolean;
  vision: boolean;
  working: boolean;
  submitting: boolean;
  onCreate: (name: string, vision: string) => Promise<void>;
  onCancelCreate?: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const g = guideStrings(t);
  const { activeId, active, live, activePath, navRoutes, navigateTo, reloadActive } = preview;
  const lastCreateError = useStudioStore((s) => s.lastCreateError);
  const startExisting = useStudioStore((s) => s.startExisting);
  const [urlDraft, setUrlDraft] = useState('/');
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setUrlDraft(activePath);
  }, [activePath]);

  const label = vision ? g.frame_vision : blueprint ? g.frame_blueprint : live ? g.frame_live : g.frame_setup;
  return (
    <div
      className={`relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-modal border bg-background shadow-elevation-3 transition-colors duration-500 ${
        working ? 'border-primary/60' : 'border-border'
      }`}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-gradient-to-r from-secondary/70 via-secondary/40 to-secondary/70 px-3">
        <span className={`h-2 w-2 rounded-full ${live && !vision ? 'bg-status-success' : 'bg-primary'}`} />
        <span className="typo-body text-foreground/85">{label}</span>
        {vision && onCancelCreate && (
          <button type="button" onClick={onCancelCreate} aria-label={t.common.close} className="ml-auto rounded-interactive p-1 text-foreground/90 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
        {live && !vision && !blueprint && activeId && (
          <div className="ml-auto flex items-center gap-1">
            <input
              value={urlDraft}
              list={navRoutes.length ? 'guide-routes' : undefined}
              onFocus={() => (editing.current = true)}
              onBlur={() => {
                editing.current = false;
                setUrlDraft(activePath);
              }}
              onChange={(e) => setUrlDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  navigateTo(urlDraft);
                  (e.target as HTMLInputElement).blur();
                }
              }}
              spellCheck={false}
              aria-label={t.studio.preview_path}
              className="w-40 rounded-input border border-border bg-background/60 px-2 py-0.5 font-mono text-sm text-foreground/85 outline-none focus:border-primary/60"
            />
            {navRoutes.length > 0 && (
              <datalist id="guide-routes">
                {navRoutes.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            )}
            <button type="button" onClick={reloadActive} aria-label={t.studio.reload_preview} className="rounded-interactive p-1.5 text-foreground/90 hover:bg-secondary/60 hover:text-foreground">
              <RotateCcw className="h-4 w-4" />
            </button>
            <StudioVersions id={activeId} onRestored={reloadActive} />
          </div>
        )}
      </header>
      <div className="relative min-h-0 flex-1">
        {vision ? (
          <div className="absolute inset-0 overflow-y-auto">
            <StudioVisionStart onSubmit={onCreate} busy={submitting} error={lastCreateError} />
          </div>
        ) : (
          children
        )}
        {!vision && active?.phase === 'error' && activeId && (
          <div className="absolute inset-x-0 bottom-6 z-20 flex justify-center">
            <div className="flex items-center gap-3 rounded-card border border-status-error/40 bg-background px-5 py-4 shadow-elevation-3">
              <span className="typo-body text-foreground">{g.boot_failed}</span>
              <AsyncButton size="sm" variant="secondary" icon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => startExisting(activeId, active.name)}>
                {t.common.retry}
              </AsyncButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
