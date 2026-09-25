// The Blueprint mounted alone, for the viewport and theme pass.
//
// Everything the page needs and nothing it does not: the app's global
// stylesheet (the ledger reads its tokens off `documentElement`), the theme
// store (so a light shot is the app's REAL light theme rather than a guessed
// attribute), the English section the page's strings live in, and the checked-in
// plan fixture, widened to as many rows as the driver asks for - because the
// defect this harness exists to catch is measured in ROWS VISIBLE, and two
// fixture rows cannot show it.
//
// The console and the lane are handed in as nodes exactly as `BlueprintPage`
// hands them in, so what is on screen here is the composition that ships.
import { useMemo } from 'react';
import ReactDOM from 'react-dom/client';

import { preloadSectionsAsync, useTranslation } from '@/i18n/useTranslation';
import type { CuratorPlan } from '@/lib/bindings/CuratorPlan';
import type { CuratorRequest } from '@/lib/bindings/CuratorRequest';
import { useThemeStore } from '@/stores/themeStore';
import '@/styles/globals.css';

import { Blueprint } from '../Blueprint';
import { CuratorConsole } from '../console/CuratorConsole';
import { RequestLane } from '../console/RequestLane';
import type { CuratorLoop } from '../console/useCuratorLoop';
import { buildModel } from '../model/buildModel';
import { EMPTY_DOCKET } from '../model/docket';
import { unmeasuredModel } from '../model/unmeasured';
import { item, plan } from '../__tests__/fixture';
import { runtime } from '../console/__tests__/fixture';
import type { BlueprintWords } from '../words';

const params = new URLSearchParams(window.location.search);
await preloadSectionsAsync('en', ['companions', 'common', 'empty_states']);
// Rehydrate FIRST, then set. The theme store persists, and `onRehydrateStorage`
// re-applies the PERSISTED theme asynchronously - so a setTheme at module top
// level is raced by it and a "light" shot comes back dark, with
// `data-theme="light"` still on the html element to make the lie convincing.
// Measured here 2026-09-25: the driver read the attribute as light and
// screenshotted a dark page.
await useThemeStore.persist.rehydrate();
useThemeStore.getState().setTheme(params.get('theme') === 'light' ? 'light' : 'dark-midnight');

const ROWS = Number(params.get('rows') ?? '16');
const QUEUE = params.get('queue') ?? 'filled';

/** The fixture plan, widened. Points descend so the rank column means something. */
function widePlan(): CuratorPlan {
  const base = plan();
  const items = Array.from({ length: Math.max(1, ROWS) }, (_, i) =>
    item({
      id: `software-engineering/subject-${String(i)}`,
      subjectId: `software-engineering/subject-${String(i)}`,
      at: `llm-agent/prompt-and-context/subject-${String(i)}`,
      points: 120 - i * 6,
    }),
  );
  return { ...base, run: { ...base.run, itemCount: items.length }, items };
}

function request(over: Partial<CuratorRequest> = {}): CuratorRequest {
  return {
    id: 'req-1',
    skill: 'intake',
    argument: 'https://example.invalid/a-paper',
    note: null,
    state: 'queued',
    createdAt: '2026-09-25T09:00:00Z',
    startedAt: null,
    settledAt: null,
    sessionId: null,
    outcome: null,
    resultRef: null,
    failureReason: null,
    ...over,
  };
}

const REQUESTS: CuratorRequest[] | null =
  QUEUE === 'unread'
    ? null
    : QUEUE === 'empty'
      ? []
      : [
          request({ id: 'r1', state: 'landed', skill: 'conform', argument: 'software-engineering', settledAt: '2026-09-25T09:31:00Z', outcome: '12 pairs judged' }),
          request({ id: 'r2', state: 'dispatched', skill: 'intake', startedAt: '2026-09-25T10:02:00Z' }),
          request({ id: 'r3', state: 'failed', skill: 'forge', argument: 'localization/czech', settledAt: '2026-09-25T10:20:00Z', failureReason: 'the worker never wrote a result' }),
          request({ id: 'r4', skill: 'hygiene', argument: null, note: 'after the sweep, please' }),
          request({ id: 'r5', skill: 'librarian', argument: 'llm-observability' }),
        ];

/** The loop, without the three doors. Every field is what a settled read gives. */
const LOOP: CuratorLoop = {
  requests: REQUESTS,
  skills: null,
  runtime: runtime({ fannedOut: null }),
  loading: false,
  file: async () => undefined,
  cancel: async () => undefined,
  reload: async () => undefined,
};

function Harness() {
  const { t, tx } = useTranslation();
  const words: BlueprintWords = useMemo(() => ({ w: t.companions.blueprint, tx }), [t, tx]);
  const model = useMemo(
    () => (params.get('plan') === '0' ? unmeasuredModel() : buildModel(widePlan())),
    [],
  );
  return (
    <Blueprint
      model={model}
      docket={EMPTY_DOCKET}
      words={words}
      console={
        // `outcome` is the LAST run's verdict. Null by default, which is what a
        // freshly opened page draws; `?said=1` puts the WIDEST of the three
        // sentences into the live region, which is what the console row has to
        // survive without taking a line off the ledger.
        <CuratorConsole
          loop={LOOP}
          policy={null}
          refreshing={false}
          outcome={params.get('said') === '1' ? { changed: null, fromCache: true } : null}
          onRefresh={async () => undefined}
        />
      }
      queue={<RequestLane requests={REQUESTS} onCancel={async () => undefined} />}
    />
  );
}

const root = document.getElementById('root');
if (root) {
  // `.cb-root` is `height: 100%` with `min-width: 0` and no width of its own,
  // so its parent has to BE the area: a block that fills the column, exactly
  // as the app's content region is. Measured 2026-09-25: with a `flex` parent
  // here instead, the root content-sized to its grid (~1540px) and every
  // 1920-wide shot showed a page that does not fill the window - a defect of
  // the harness, not of the page.
  ReactDOM.createRoot(root).render(
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="min-h-0 flex-1 overflow-hidden">
        <Harness />
      </div>
    </div>,
  );
}
