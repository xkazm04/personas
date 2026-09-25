// The Process page mounted alone, for the pixel pass: the global stylesheet, the theme store,
// the English sections the page reads, and a reading handed in through the warm slot so a shot
// never needs a paired registry. `?reading=` names a URL the dev server serves.
import ReactDOM from 'react-dom/client';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { CuratorProcess } from '@/lib/bindings/CuratorProcess';
import { useThemeStore } from '@/stores/themeStore';
import '@/styles/globals.css';

import ProcessPage from '../ProcessPage';
import { primeProcessReading } from '../useProcessData';
import { primeExtraLanes, type ProcessLane } from '../lanes';
import { ascentSampleLane, hiringLane } from './sampleLanes';

const params = new URLSearchParams(window.location.search);
useThemeStore.getState().setTheme(params.get('theme') === 'light' ? 'light' : 'dark-midnight');
await preloadSectionsAsync('en', ['companions', 'sidebar', 'common', 'empty_states']);
const url = params.get('reading');
if (url) primeProcessReading((await (await fetch(url)).json()) as CuratorProcess);
// `?kp=<url>` adds the KP hiring lane (the contest's projected cohort); `?sample=1` the Ascent sample.
const extra: ProcessLane[] = [];
const kp = params.get('kp');
if (kp) extra.push(hiringLane((await (await fetch(kp)).json()) as Parameters<typeof hiringLane>[0]));
if (params.get('sample')) extra.push(ascentSampleLane());
primeExtraLanes(extra);

const root = document.getElementById('root');
if (root) {
  ReactDOM.createRoot(root).render(
    // `ContentBox` fills a flex column and has no height of its own; the app gives it one.
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex flex-1 overflow-hidden">
        <ProcessPage />
      </div>
    </div>,
  );
}
