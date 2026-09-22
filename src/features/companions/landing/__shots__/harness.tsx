// The Companions landing, mounted alone, for the promotion pass.
//
// Two frames, because two different questions are being asked:
//
//   ?frame=winner  the triptych inside the prototype's own chrome heights
//                  (52px bar, 42px key row). The design is written in
//                  CONTAINER units, so a computed font size is only
//                  comparable to the winner's when the container is the same
//                  box; this frame is what `style-contract.py check` measures.
//   ?frame=app     the INTEGRATED page - ContentBox / ContentHeader /
//                  ContentBody, exactly as the router renders it - which is
//                  what the committed screenshots show.
//
// `?scenario=` picks one of the contest's staged scenarios, `?theme=light`
// the app's real light theme, `?loading=1` the cold-load ghost and
// `?error=1` the failed read.
import ReactDOM from 'react-dom/client';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { AppKeyboardProvider } from '@/lib/keyboard/AppKeyboardProvider';
import { useThemeStore } from '@/stores/themeStore';
import '@/styles/globals.css';

import { CompanionsTriptych } from '../CompanionsTriptych';
import { LandingSurface } from '../LandingPage';
import type { CompanionColumnView } from '../landingModel';
import { scenarioOf } from './scenarios';

declare global {
  interface Window {
    /** What the last column activation asked for, so a drive can assert the destination. */
    __companionsOpened?: { id: string; target: string } | null;
  }
}

const params = new URLSearchParams(window.location.search);
useThemeStore.getState().setTheme(params.get('theme') === 'light' ? 'light' : 'dark-midnight');

// The app's own text-scale ladder is 15 / 16.5 / 18px and its default is
// `larger`, so the product NEVER runs at the 16px root a plain browser gives -
// which is the root the prototype was judged at. `?root=16` pins it, so the
// style contract can prove exact equality with the winner; without it the same
// rules render 3% larger, which is the user's setting working, not drift.
const pinnedRoot = params.get('root');
if (pinnedRoot) document.documentElement.style.fontSize = `${pinnedRoot}px`;

await preloadSectionsAsync('en', ['companions', 'common', 'sidebar', 'empty_states']);

const loading = params.get('loading') === '1';
const companions = loading ? null : scenarioOf(params.get('scenario'));
const error = params.get('error') === '1' ? 'Could not read the companions status.' : null;

function onOpen(view: CompanionColumnView) {
  window.__companionsOpened = { id: view.id, target: view.target };
}

const props = { companions, loading, error, onOpen, onRetry: () => {} };

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    <AppKeyboardProvider>
      {params.get('frame') === 'app' ? (
        // `ContentBox` is `flex-1 min-h-0`: it fills a flex column and has no
        // height of its own. `App.tsx` gives it one; without the same two
        // lines here every shot would be a lie about the layout.
        <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
          <div className="flex flex-1 overflow-hidden">
            <LandingSurface {...props} />
          </div>
        </div>
      ) : (
        <div className="hl-shot-frame">
          <div />
          <CompanionsTriptych {...props} />
          <div />
        </div>
      )}
    </AppKeyboardProvider>,
  );
}
