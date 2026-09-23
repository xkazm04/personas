// The Features page mounted alone, for the pixel pass.
//
// The twin of `companions/curator/council/__shots__/harness.tsx`: the app's stylesheet, the
// real theme store, the English section chunks the page's strings live in and
// the keyboard provider - and nothing else. The page loads its own checked-in
// fixture through its own DEV toggle, so a shot never depends on a scanned
// project.
import ReactDOM from 'react-dom/client';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { safeLocalSet } from '@/lib/safeLocalStorage';
import { useThemeStore } from '@/stores/themeStore';
import '@/styles/globals.css';

import FeaturesPage from '../FeaturesPage';

const params = new URLSearchParams(window.location.search);
useThemeStore.getState().setTheme(params.get('theme') === 'light' ? 'light' : 'dark-midnight');
// `?variant=board|cadastre` pins the persisted switch before the page reads it,
// so a shot names the surface it shows.
const variant = params.get('variant');
if (variant) safeLocalSet('features-variant', variant, 'features:variant');
// `?measure=1` renders at the conditions a contest winner was judged at, for
// the style-contract check: a 16px root (the product's default text scale is
// 16.5px) and no brightness filter (the product brightens the whole page and
// pre-darkens its status tokens to match; the winner had neither). Both are
// user settings, not the page's, so a contract measured without pinning them
// compares a preference, not a port. Shots keep the product's defaults.
if (params.get('measure') === '1') {
  const html = document.documentElement;
  html.style.fontSize = '16px';
  html.style.setProperty('--app-brightness', '1');
  html.removeAttribute('data-brightness');
}

await preloadSectionsAsync('en', ['features', 'plugins', 'sidebar', 'common', 'empty_states', 'council']);

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <AppKeyboardProvider>
      {/* `ContentBox` is `flex-1 min-h-0` and has no height of its own; the
          app gives it one at `App.tsx:374,391`. Without the same two lines
          the page renders short and every shot is a lie about the layout. */}
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="flex flex-1 overflow-hidden">
          <FeaturesPage />
        </div>
      </div>
    </AppKeyboardProvider>,
  );
}
