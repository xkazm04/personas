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
import { useThemeStore } from '@/stores/themeStore';
import '@/styles/globals.css';

import FeaturesPage from '../FeaturesPage';

const params = new URLSearchParams(window.location.search);
useThemeStore.getState().setTheme(params.get('theme') === 'light' ? 'light' : 'dark-midnight');

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
