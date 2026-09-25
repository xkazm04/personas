/**
 * VERIFICATION ONLY - not part of the variant's surface.
 *
 * Mounts this variant inside the app shell's real geometry (48px titlebar,
 * 88 + 240px rails, the same main column) against the product's real
 * stylesheet, so it can be driven in a browser at 1000x640 and 1920x1080 in
 * both themes without a Tauri runtime. It is the same frame
 * `scripts/style/page-harness/main.tsx` uses; this copy exists so the seat adds
 * nothing outside its own directory.
 *
 *   npm run dev
 *   http://localhost:1420/src/features/companions/curator/blueprint/v2/variants/a/harness.html?theme=dark-midnight
 *
 * There is no IPC here: `useLanes` catches the failed reads through
 * `silentCatch` and reports both lanes as `unread`, which is one of the three
 * states the page is designed for.
 */
import '@/styles/globals.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { useThemeStore, type TextScale, type ThemeId } from '@/stores/themeStore';
import { getEnglishTranslationsAsync } from '@/i18n/useTranslation';

import BlueprintV2VariantA from './index';

const params = new URLSearchParams(window.location.search);
const themeId = (params.get('theme') ?? 'dark-midnight') as ThemeId;
const textScale = (params.get('textScale') ?? 'larger') as TextScale;

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="titlebar" />
      <div className="relative flex flex-col flex-1 min-h-0 w-full min-w-0 bg-background text-foreground overflow-hidden">
        <div className="relative z-10 flex flex-1 overflow-hidden">
          <div className="flex shrink-0">
            <div className="w-[88px] border-r border-primary/15" />
            <div className="w-[240px] bg-secondary/30 border-r border-primary/15" />
          </div>
          <div id="main-content" role="main" className="flex-1 flex flex-col overflow-x-auto overflow-y-hidden pb-8">
            <div className="flex-1 flex flex-col w-full min-w-0 overflow-y-hidden">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

async function boot(): Promise<void> {
  const theme = useThemeStore.getState();
  theme.setTheme(themeId);
  theme.setTextScale(textScale);
  await getEnglishTranslationsAsync();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Frame>
        <BlueprintV2VariantA />
      </Frame>
    </StrictMode>,
  );
}

void boot();
