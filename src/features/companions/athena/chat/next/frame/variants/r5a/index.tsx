/**
 * R5 · A - "Presence island". Athena is ONE living object: a small glass
 * capsule at the bottom centre of the window (her face, one label, the human
 * gate, the key) that grows - the same glass, one continuous shape - into the
 * conversation sheet or a decision sheet and folds back on Esc. The right edge
 * carries her run threads as a slim column of pills that widens in place into
 * the thread board. Quiet until something matters: only her ring moves, and
 * only while she works; only a gate breathes, and only while it waits on you.
 *
 * Owns its own layer like Filament (`ChatVariantHost`), on the product's
 * `useLayer` contract (Alt+W / Esc, `view.kind === 'work'` with `view.focus`).
 *
 * TODO(prototype, 2026-10-07): athena chat round 5 - consolidate after the owner picks.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAthenaStore } from '../../../../../athenaStore';
import type { AthenaChatEngine } from '../../../../athenaChatEngine';
import { RefOpenerProvider } from '../../../../refs/RefOpenerContext';
import { NEXT_COPY as C } from '../../../nextCopy';
import { useLayer } from '../../../useLayer';
import { useLayerRefOpener } from '../../../useLayerRefOpener';
import { useProcessColumns } from '../../../useProcessColumns';
import { useWorkforce } from '../../../useWorkforce';
import { ConversationBody } from './ConversationBody';
import { DecisionSheet } from './DecisionSheet';
import { Island, useLayerSize, type IslandMode } from './Island';
import { IslandCapsule } from './IslandCapsule';
import { IslandComposer } from './IslandComposer';
import { SendFlight, useSendFlight } from './SendFlight';
import { ThreadRail } from './ThreadRail';
import { useCapsuleRead } from './useCapsuleRead';
import { useIslandKeys } from './useIslandKeys';
import { useThreads } from './useThreads';
import './island.css';

const closeBrain = () => useAthenaStore.getState().setBrainView({ open: false, kind: null, id: null });

export function R5AFrame({ engine, lifted }: { engine: AthenaChatEngine; lifted: boolean }) {
  const workforce = useWorkforce();
  const columns = useProcessColumns(workforce, C.athena);
  const lanes = useThreads(columns, workforce);
  const layer = useLayer();
  const { view } = layer;
  const refOpener = useLayerRefOpener(layer, workforce.items);
  const brainOpen = useAthenaStore((s) => s.brainView.open);
  const streaming = useAthenaStore((s) => s.streaming);
  const read = useCapsuleRead(engine.messages, lanes, workforce.counts.waiting);
  const layerRef = useRef<HTMLDivElement>(null);
  const capsuleRef = useRef<HTMLButtonElement>(null);
  const size = useLayerSize(layerRef);
  const { flight, launch, land } = useSendFlight(layerRef);

  const [sheet, setSheet] = useState(false);
  const [tall, setTall] = useState(false);
  const [board, setBoard] = useState(false);
  const [seed, setSeed] = useState('');
  const [decideH, setDecideH] = useState(0);

  const mode: IslandMode =
    view.kind === 'work' && !brainOpen
      ? 'decide'
      : brainOpen || view.kind === 'report'
        ? 'tall'
        : sheet || view.kind === 'turn'
          ? tall
            ? 'tall'
            : 'chat'
          : 'rest';

  // One thing open at a time: the island growing folds the board.
  const [prevMode, setPrevMode] = useState(mode);
  if (mode !== prevMode) {
    setPrevMode(mode);
    if (mode !== 'rest' && board) setBoard(false);
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
  const openItem = (id: string) => {
    setBoard(false);
    layer.openWork(id, null);
  };
  const toggleBoard = () => {
    if (!board && mode !== 'rest') fold();
    setBoard((b) => !b);
  };

  useIslandKeys({
    mode,
    board,
    brainOpen,
    onToggleChat: () => (mode === 'chat' || mode === 'tall' ? fold() : openChat()),
    onToggleBoard: toggleBoard,
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

  const open =
    mode === 'decide' ? (
      <DecisionSheet
        items={workforce.items}
        focusId={focusId}
        onFocus={(id) => layer.openWork(id, null)}
        onFold={layer.back}
        onSend={engine.send}
        working={streaming}
        onMeasure={setDecideH}
      />
    ) : (
      <ConversationBody
        engine={engine}
        layer={layer}
        tall={tall}
        gated={workforce.counts.waiting > 0}
        onToggleTall={() => setTall((v) => !v)}
        onFold={fold}
      />
    );

  return (
    <RefOpenerProvider value={refOpener}>
      <div
        ref={layerRef}
        className={`r5a fixed inset-x-0 bottom-0 top-[112px] ${lifted ? 'z-[220]' : 'z-[120]'} pointer-events-none`}
        data-testid="companion-panel"
        data-chat-variant="r5a"
        data-island-mode={mode}
      >
        <Island
          mode={mode}
          layer={size}
          decideContentH={decideH}
          rest={<IslandCapsule ref={capsuleRef} read={read} onOpen={openChat} onOpenGate={() => layer.openWork()} />}
          open={
            <>
              {open}
              <IslandComposer engine={engine} about={about} seed={seed} autoFocus={mode === 'chat'} onLaunch={launch} />
            </>
          }
        />
        <ThreadRail
          lanes={lanes}
          threads={workforce.threads}
          open={board}
          onToggle={toggleBoard}
          onOpenItem={openItem}
          onOpenChat={() => {
            setBoard(false);
            openChat();
          }}
        />
        <SendFlight flight={flight} onLand={land} />
      </div>
    </RefOpenerProvider>
  );
}

export default R5AFrame;
