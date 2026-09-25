/**
 * A standalone mount for this variant, in the app shell's real geometry.
 *
 * It exists so the variant can be driven in a browser without the Tauri
 * runtime: the page reads no IPC (its plan and its lane come from `fixture.ts`,
 * and the one listener it installs fails closed outside Tauri), so the only
 * things it needs are the real stylesheet, the theme store and the English
 * bundle. The frame reproduces `scripts/style/page-harness`'s columns - a 48px
 * titlebar, an 88px rail and a 240px menu - so 1000x640 here is the 1000x640
 * the constraint is written about.
 *
 *   npx vite --port 1433 --strictPort
 *   /src/features/companions/curator/blueprint/v2/variants/b/harness.html?theme=dark-midnight
 *
 * Prototype scaffolding; it goes with the switcher when a variant is fused.
 */
import '@/styles/globals.css';
import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

import { silentCatch } from '@/lib/silentCatch';

import Variant from './index';

const params = new URLSearchParams(window.location.search);
const themeId = params.get('theme') ?? 'dark-midnight';
const textScale = params.get('textScale') ?? 'standard';
const brightness = params.get('brightness');

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="titlebar" data-harness="titlebar-gutter" />
      <div className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden">
        <div className="relative z-10 flex flex-1 overflow-hidden">
          <div data-harness="sidebar-gutter" className="flex shrink-0">
            <div className="w-[88px] border-r border-primary/15" />
            <div className="w-[240px] border-r border-primary/15 bg-secondary/30" />
          </div>
          <div id="main-content" role="main" className="flex flex-1 flex-col overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

async function boot(): Promise<void> {
  const [{ useThemeStore }, { getEnglishTranslationsAsync }] = await Promise.all([
    import('@/stores/themeStore'),
    import('@/i18n/useTranslation'),
  ]);
  const theme = useThemeStore.getState();
  theme.setTheme(themeId as Parameters<typeof theme.setTheme>[0]);
  theme.setTextScale(textScale as Parameters<typeof theme.setTextScale>[0]);
  if (brightness) theme.setBrightness(brightness as Parameters<typeof theme.setBrightness>[0]);
  await getEnglishTranslationsAsync();

  const host = document.getElementById('root');
  if (!host) throw new Error('harness: no #root');
  createRoot(host).render(
    <StrictMode>
      <Frame>
        <Variant />
      </Frame>
    </StrictMode>,
  );
}

// The harness is a development entry point with no user and no toast surface,
// so a failed boot goes through the app's own background-error door.
void boot().catch(silentCatch('curator:blueprint:v2b:harness'));
