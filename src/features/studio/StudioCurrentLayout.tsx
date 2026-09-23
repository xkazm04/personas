import { useEffect, useRef, useState } from 'react';
import { Bot, RotateCcw } from 'lucide-react';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import StudioChatInput from './StudioChatInput';
import StudioVisionStart from './StudioVisionStart';
import StudioVersions from './StudioVersions';
import StudioPreviewFrames from './StudioPreviewFrames';
import { useStudioStore } from './studioStore';
import { useStudioPreview } from './useStudioPreview';

// The original Studio layout: full-bleed warm previews, a floating preview
// toolbar and the dock. Kept unchanged behind the layout switch until the Guide
// layout reaches parity (docs/design/studio-guide.md).
export default function StudioCurrentLayout({
  showVision,
  submitting,
  onCreate,
}: {
  showVision: boolean;
  submitting: boolean;
  onCreate: (name: string, vision: string) => Promise<void>;
}) {
  const { t } = useTranslation();
  const preview = useStudioPreview();
  const { activeId, active, live, activePath, navRoutes, navigateTo, reloadActive } = preview;
  const lastCreateError = useStudioStore((s) => s.lastCreateError);
  const startExisting = useStudioStore((s) => s.startExisting);
  const [urlDraft, setUrlDraft] = useState('/');
  const urlEditing = useRef(false);

  // Keep the address-bar draft synced to the live path, unless the user is editing.
  useEffect(() => {
    if (!urlEditing.current) setUrlDraft(activePath);
  }, [activePath]);

  return (
    <div className="relative min-h-0 w-full min-w-0 flex-1 bg-black/20">
      {showVision ? (
        <StudioVisionStart onSubmit={onCreate} busy={submitting} error={lastCreateError} />
      ) : (
        <>
          <StudioPreviewFrames preview={preview} />

          {active && live && activeId ? (
            <>
              {/* Unified preview toolbar: reload · routes · versions in one bar. */}
              <div className="absolute left-1/2 top-3 z-20 flex w-[min(34rem,82%)] -translate-x-1/2 items-center gap-0.5 rounded-full border border-border bg-background/85 px-1.5 py-1 shadow-elevation-2 backdrop-blur">
                <button
                  type="button"
                  onClick={reloadActive}
                  aria-label={t.studio.reload_preview}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-foreground/65 transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
                {/* Address bar: type any path + Enter to load it; live-syncs to where the preview navigates. */}
                <div className="flex min-w-0 flex-1 items-center">
                  <input
                    data-testid="studio-preview-url"
                    value={urlDraft}
                    list={navRoutes.length ? 'studio-routes' : undefined}
                    onFocus={() => {
                      urlEditing.current = true;
                    }}
                    onBlur={() => {
                      urlEditing.current = false;
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
                    placeholder="/"
                    className="min-w-0 flex-1 bg-transparent px-2 font-mono text-xs text-foreground/85 outline-none placeholder:text-foreground/40"
                  />
                  {navRoutes.length > 0 && (
                    <datalist id="studio-routes">
                      {navRoutes.map((r) => (
                        <option key={r} value={r} />
                      ))}
                    </datalist>
                  )}
                </div>
                <span className="mx-0.5 h-4 w-px shrink-0 bg-border" />
                <StudioVersions id={activeId} onRestored={reloadActive} />
              </div>
              <StudioChatInput />
            </>
          ) : active ? (
            <div className="absolute inset-0 flex items-center justify-center px-6">
              <div className="flex items-center gap-3 rounded-card border border-border bg-background/80 px-5 py-4 shadow-elevation-2">
                <Bot className="h-5 w-5 text-primary" />
                <span className="text-md text-foreground/80">
                  {active.phase === 'scaffolding'
                    ? t.studio.scaffolding
                    : active.phase === 'starting'
                      ? t.studio.starting
                      : active.phase === 'error'
                        ? t.studio.start_error
                        : active.name}
                </span>
                {/* A boot that gave up says so, with a way out. `startExisting` is
                    idempotent for a project already open, so it is a cold restart. */}
                {active.phase === 'error' && activeId && (
                  <AsyncButton
                    size="sm"
                    variant="secondary"
                    icon={<RotateCcw className="h-3.5 w-3.5" />}
                    onClick={() => startExisting(activeId, active.name)}
                  >
                    {t.common.retry}
                  </AsyncButton>
                )}
              </div>
            </div>
          ) : (
            <div className="absolute inset-0 flex items-center justify-center px-6 text-center">
              <p className="typo-caption max-w-sm">{t.studio.no_project_open}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
