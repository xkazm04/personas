/**
 * Style page harness: mounts ONE module's real page component, inside a frame
 * that reproduces the app shell's geometry (titlebar, sidebar width, main
 * content column), on data replayed from an IPC tape. Driven by
 * `scripts/style/shoot.mjs`; also usable by hand:
 *
 *   /scripts/style/page-harness/index.html?module=overview/sub_events&theme=dark-midnight&tape=/tmp/style-tapes/x.json
 *
 * Only the tape player and the stylesheet load statically. Everything that can
 * reach IPC loads after the mock is installed, so no store's module-init call
 * can hit a missing Tauri runtime.
 */
import '@/styles/globals.css';
import { Component, StrictMode, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { installTape, type ReplayLog, type Tape } from './tapePlayer';

interface HarnessState extends ReplayLog {
  module: string;
  theme: string;
  mounted: boolean;
  error: string | null;
  tapeSource: string | null;
}

declare global {
  interface Window {
    __PAGE_HARNESS__?: HarnessState;
    __PAGE_HARNESS_TAPE__?: Tape;
    __IPC_TOKEN?: string;
  }
}

const params = new URLSearchParams(window.location.search);
const moduleId = params.get('module') ?? '';
const themeId = params.get('theme') ?? 'dark-midnight';
const textScale = params.get('textScale') ?? 'larger';
// Unset = the store default ('low': 1.25 on dark, 0.82 "Dimmer" on light), as a fresh profile gets.
const brightness = params.get('brightness');

const state: HarnessState = {
  module: moduleId,
  theme: themeId,
  mounted: false,
  error: null,
  tapeSource: null,
  hits: {},
  unknown: [],
  argsMismatch: [],
};
window.__PAGE_HARNESS__ = state;

function fail(message: string): void {
  state.error = message;
  console.error(`[page-harness] ${message}`);
}

class Boundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) };
  }
  componentDidCatch(err: unknown) {
    fail(`render crashed: ${err instanceof Error ? err.message : String(err)}`);
  }
  render() {
    if (this.state.error) {
      return <pre data-harness="error" className="p-6 text-status-error whitespace-pre-wrap">{this.state.error}</pre>;
    }
    return this.props.children;
  }
}

function MountedFlag({ children }: { children: ReactNode }) {
  useEffect(() => {
    state.mounted = true;
  }, []);
  return <>{children}</>;
}

/**
 * The app shell's geometry without its contents: the 48px titlebar, the 88px +
 * 240px sidebar columns and the main column with the same classes as
 * `PersonasPage` (#main-content). The gutters are empty on purpose so a shot
 * shows only the page under test, at the width it really gets.
 */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-background text-foreground">
      <div className="titlebar" data-harness="titlebar-gutter" />
      <div className="relative flex flex-col flex-1 min-h-0 w-full min-w-0 bg-background text-foreground overflow-hidden">
        <div className="absolute inset-0 transform-gpu backface-hidden bg-[linear-gradient(rgba(59,130,246,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(59,130,246,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none" />
        <div className="absolute inset-0 transform-gpu backface-hidden bg-gradient-to-b from-background/0 via-background/0 to-background/80 pointer-events-none" />
        <div className="relative z-10 flex flex-1 overflow-hidden">
          <div data-harness="sidebar-gutter" className="flex shrink-0">
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

async function loadTape(): Promise<Tape | null> {
  if (window.__PAGE_HARNESS_TAPE__) {
    state.tapeSource = 'injected';
    return window.__PAGE_HARNESS_TAPE__;
  }
  const url = params.get('tape');
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`tape fetch ${url} -> HTTP ${res.status}`);
  state.tapeSource = url;
  return (await res.json()) as Tape;
}

async function boot(): Promise<void> {
  window.__IPC_TOKEN = 'page-harness';
  const tape = await loadTape();
  if (!tape) {
    fail('no tape: the shooter injects one, or pass ?tape=<url>');
    return;
  }
  installTape(tape, state);

  const [{ MODULES }, { useThemeStore }, { getEnglishTranslationsAsync }] = await Promise.all([
    import('./registry'),
    import('@/stores/themeStore'),
    import('@/i18n/useTranslation'),
  ]);
  const entry = MODULES[moduleId];
  if (!entry) {
    fail(`unknown module "${moduleId}". Registered: ${Object.keys(MODULES).join(', ')}`);
    return;
  }

  const theme = useThemeStore.getState();
  theme.setTheme(themeId as Parameters<typeof theme.setTheme>[0]);
  theme.setTextScale(textScale as Parameters<typeof theme.setTextScale>[0]);
  theme.setDensity(theme.density);
  if (brightness) theme.setBrightness(brightness as Parameters<typeof theme.setBrightness>[0]);

  await getEnglishTranslationsAsync();
  await entry.prepare?.();
  const wrap = entry.providers ? await entry.providers() : (children: ReactNode) => children;
  const Page = lazy(entry.load);

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Frame>
        <Boundary>
          <Suspense fallback={null}>
            {wrap(
              <MountedFlag>
                <Page />
              </MountedFlag>,
            )}
          </Suspense>
        </Boundary>
      </Frame>
    </StrictMode>,
  );
}

boot().catch((err: unknown) => fail(`boot failed: ${err instanceof Error ? err.message : String(err)}`));
