/**
 * Fusion - the owner's fusion of round 5 (2026-10-07). Five pieces he named,
 * each kept and fitted to the others:
 *   - the bottom panel is R5 · A's island: a capsule that grows into the
 *     conversation sheet and folds back on Esc, with the send flight and the
 *     smooth streaming reveal (`Island`, `IslandCapsule`, `Composer`,
 *     `SendFlight`, `StreamingTurn`);
 *   - the conversation inside it is space-efficient and renders through
 *     Current's own pieces (`Transcript`, `TurnRow`, `MachineFold`);
 *   - the right side is Filament's slim rail and expandable toolset, restyled
 *     to the theme, carrying R5 · C's pending count, the attention beads and
 *     what Athena manages as category circles (`Rail` and its parts);
 *   - a decision is Spread's keyboard Oracle re-designed: the question its own
 *     block, the answers separate cards flying in over the app, her pick
 *     branded once she gives it (`DecisionStage` and its parts).
 *
 * Owns its own layer like Filament (`ChatVariantHost`), on the product's
 * `useLayer` contract (Alt+W / Esc, `view.kind === 'work'` with `view.focus`).
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { AnimatePresence } from 'framer-motion';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { RefOpenerProvider } from '../../../../refs/RefOpenerContext';
import { NEXT_COPY as C } from '../../../nextCopy';
import { useLayer } from '../../../useLayer';
import { useLayerRefOpener } from '../../../useLayerRefOpener';
import { useProcessColumns } from '../../../useProcessColumns';
import { useWorkforce } from '../../../useWorkforce';
import { Composer } from './Composer';
import { Conversation } from './Conversation';
import { DecisionStage } from './DecisionStage';
import { Island, useLayerSize, type IslandMode } from './Island';
import { IslandCapsule } from './IslandCapsule';
import { Rail } from './Rail';
import { SendFlight, useSendFlight } from './SendFlight';
import { useCapsuleRead } from './useCapsuleRead';
import { useIslandKeys } from './useIslandKeys';
import { useManaged } from './useManaged';
import './fusion.css';

const closeBrain = () => useAthenaStore.getState().setBrainView({ open: false, kind: null, id: null });

export function FusionFrame({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  const columns = useProcessColumns(workforce, C.athena);
  const categories = useManaged(workforce, columns);
  const layer = useLayer();
  const { view } = layer;
  const refOpener = useLayerRefOpener(layer, workforce.items);
  const brainOpen = useAthenaStore((s) => s.brainView.open);
  const read = useCapsuleRead(engine.messages, workforce.counts.live, workforce.counts.waiting);
  const layerRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLButtonElement>(null);
  const size = useLayerSize(layerRef);
  const { flight, launch, land } = useSendFlight(layerRef);

  const [sheet, setSheet] = useState(false);
  const [tall, setTall] = useState(false);
  const [seed, setSeed] = useState('');

  const mode: IslandMode =
    view.kind === 'work' && !brainOpen
      ? 'decide'
      : brainOpen || view.kind === 'report'
        ? 'tall'
        : sheet
          ? tall
            ? 'tall'
            : 'chat'
          : 'rest';

  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) {
    setPrevMode(mode);
    if (mode === 'rest' && seed) setSeed('');
  }

  const focusId = view.kind === 'work' ? (view.focus ?? workforce.items[0]?.id ?? null) : null;
  const about = useMemo(
    () => (view.kind === 'work' ? (workforce.items.find((i) => i.id === focusId) ?? null) : null),
    [view.kind, workforce.items, focusId],
  );

  const openChat = (first?: string) => {
    if (view.kind !== 'chat') layer.back();
    if (first) setSeed(first);
    setSheet(true);
  };
  const fold = () => {
    setSheet(false);
    setTall(false);
    if (view.kind !== 'chat') layer.back();
    if (brainOpen) closeBrain();
  };
  const openItem = (id: string | null) => {
    if (view.kind === 'work' && (id === null || id === focusId)) layer.back();
    else layer.openWork(id, null);
  };

  useIslandKeys({
    mode,
    brainOpen,
    onToggleChat: () => (mode === 'chat' || mode === 'tall' ? fold() : openChat()),
    onFold: fold,
    onCloseBrain: closeBrain,
  });

  // The caret follows the conversation; folding hands focus back to the capsule
  // (only on a fold - mounting at rest never takes focus from the app).
  const lastMode = useRef(mode);
  useEffect(() => {
    const was = lastMode.current;
    lastMode.current = mode;
    if (was === mode) return;
    const root = layerRef.current;
    if (!root) return;
    if (mode === 'chat') root.querySelector<HTMLElement>('[data-testid="companion-input"]')?.focus({ preventScroll: true });
    if (mode === 'rest') {
      const el = document.activeElement;
      if (!el || el === document.body || root.contains(el)) capsuleRef.current?.focus({ preventScroll: true });
    }
  }, [mode]);

  return (
    <RefOpenerProvider value={refOpener}>
      <div
        ref={layerRef}
        className={`fusion fixed inset-x-0 bottom-0 top-[112px] ${lifted ? 'z-[220]' : 'z-[120]'} pointer-events-none`}
        data-testid="companion-panel"
        data-chat-variant="fusion"
        data-island-mode={mode}
      >
        <AnimatePresence>
          {mode === 'decide' && (
            <DecisionStage
              key="stage"
              items={workforce.items}
              focusId={focusId}
              onFocus={(id) => layer.openWork(id, null)}
              onFold={layer.back}
              onSend={engine.send}
            />
          )}
        </AnimatePresence>
        <Island
          mode={mode}
          layer={size}
          rest={<IslandCapsule ref={capsuleRef} read={read} onOpen={openChat} onOpenGate={() => layer.openWork()} />}
          open={
            <>
              {mode !== 'decide' && (
                <Conversation
                  engine={engine}
                  layer={layer}
                  tall={tall}
                  gated={workforce.counts.waiting > 0}
                  onToggleTall={() => setTall((v) => !v)}
                  onFold={fold}
                />
              )}
              <Composer engine={engine} about={about} seed={seed} autoFocus={mode === 'chat'} onLaunch={launch} />
            </>
          }
        />
        <Rail items={workforce.items} categories={categories} onOpenItem={openItem} />
        <SendFlight flight={flight} onLand={land} />
      </div>
    </RefOpenerProvider>
  );
}

export default FusionFrame;
