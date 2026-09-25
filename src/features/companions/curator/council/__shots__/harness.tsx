// The Council page mounted alone, for the pixel pass.
//
// Everything the page needs and nothing it does not: the app's global
// stylesheet (the canvas reads its tokens off `documentElement`), the theme
// store (so a light shot is the app's real light theme rather than a guessed
// attribute), the English section chunks the page's strings live in, the
// keyboard provider the stage and the bench both register with, and the
// checked-in reference fixture so a shot never depends on a paired registry.
//
// `window.__council` hands the driver the live engine, which is the only way
// a screenshot script can assert that a camera came back exactly.
import ReactDOM from 'react-dom/client';

import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { safeLocalSet } from '@/lib/safeLocalStorage';
import { useThemeStore } from '@/stores/themeStore';
import '@/styles/globals.css';

import CouncilPage from '../CouncilPage';
import { useCouncilStore } from '../councilStore';
import type { GalaxyEngine } from '../galaxy/engine/GalaxyEngine';

declare global {
  interface Window {
    /** The live engine, once the stage has published it. */
    __council?: GalaxyEngine | null;
    /**
     * The store, so a shot script can compute WHERE a node is drawn from the
     * engine's own camera instead of hunting for it by clicking around. A
     * hunt finds a target eventually and tells you nothing about which one.
     */
    __councilStore?: typeof useCouncilStore;
  }
}

const params = new URLSearchParams(window.location.search);
useThemeStore.getState().setTheme(params.get('theme') === 'light' ? 'light' : 'dark-midnight');
// `?variant=classic|fused` pins the persisted switch before the page reads it,
// so a shot names the stage it shows.
const variant = params.get('variant');
if (variant) safeLocalSet('council-variant', variant, 'council:variant');

// The council strings and the chrome the page borrows. `sidebar` carries the
// page's own title through `ContentHeader`.
await preloadSectionsAsync('en', ['council', 'sidebar', 'common', 'empty_states']);
// `?fixture=0` leaves the registry unpaired, which is a STATE of this page
// and has to be shot like any other.
if (params.get('fixture') !== '0') await useCouncilStore.getState().loadFixture();

window.__councilStore = useCouncilStore;
useCouncilStore.subscribe((s) => {
  window.__council = s.engine;
});

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <AppKeyboardProvider>
      {/* `ContentBox` is `flex-1 min-h-0` - it fills a FLEX COLUMN and has no
          height of its own. The app gives it one at `App.tsx:374,391`
          (`h-screen` then `flex flex-1`); without the same two lines here the
          page renders about two thirds tall and every shot is a lie about
          the layout. */}
      <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
        <div className="flex flex-1 overflow-hidden">
          <CouncilPage />
        </div>
      </div>
    </AppKeyboardProvider>,
  );
}
