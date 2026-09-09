// The Strata design board — a contact sheet of recipes, for pointing at.
//
// One live WebGL canvas (the "stage") does two jobs in turn. First it walks
// the queue: for each recipe × frame it mounts the scene, waits a few dozen
// frames for the camera to land and the decks to settle, reads the buffer
// back as a JPEG, and moves on. Then it becomes the expanded view of whichever
// cell the operator clicked, with orbit controls. One canvas rather than a
// grid of live ones because a live grid of ten-project scenes is a few
// thousand draw calls a frame, and a board is static until you orbit it.
//
// Below the stage: the cells, one column per recipe and one row per frame,
// with the recipe's id and axis values as its label. Star a cell to pick it;
// the picks line at the top is what to paste back into chat. At the bottom a
// 2D canvas composes every cell into a single contact sheet — that is what
// `scripts/capture-canvas.mjs` grabs, and what the operator can save.
//
// Dev-only. It lives behind the switcher only in dev builds, and it reads the
// same mock world the prototypes do.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from '@/i18n/useTranslation';

import { MOCK_WORLD } from '../mockWorld';
import { StrataScene } from '../StrataWorld';
import type { WorldFocus } from '../worldModel';
import { boardAxes, CURRENT_BOARD, type DesignRecipe } from './recipes';
import { BOARD_FRAMES, staticNav } from './staticNav';
import './board.css';

/** Stage size in CSS px. The board renders at DPR 1 so a shot is this size. */
const STAGE_W = 960;
const STAGE_H = 600;
/** Frames to wait before reading the buffer: the camera flight is instant on
 *  first mount, but the decks damp into place over ~30 frames. */
const SETTLE_FRAMES = 40;
/** Recipes per band on the contact sheet. */
const SHEET_PER_ROW = 5;

interface Cell { recipe: DesignRecipe; level: 0 | 1; focus: WorldFocus }
type ShotKey = `${string}:${0 | 1}`;
const shotKey = (c: Cell): ShotKey => `${c.recipe.id}:${c.level}`;

/** Reads the previous frame's buffer once `frames` frames have elapsed. Runs
 *  inside the Canvas; needs preserveDrawingBuffer on the renderer. */
function Snapshot({ frames, onShot }: { frames: number; onShot: (dataUrl: string) => void }) {
  const gl = useThree((s) => s.gl);
  const n = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    if (done.current) return;
    n.current += 1;
    if (n.current >= frames) {
      done.current = true;
      onShot(gl.domElement.toDataURL('image/jpeg', 0.82));
    }
  });
  return null;
}

export default function DesignBoard() {
  const { t, tx } = useTranslation();
  const board = CURRENT_BOARD;
  const axes = useMemo(() => boardAxes(board), [board]);
  const cells = useMemo<Cell[]>(() => board.flatMap((recipe) => BOARD_FRAMES.map((f) => ({ recipe, level: f.level, focus: f.focus }))), [board]);

  const [shots, setShots] = useState<Record<string, string>>({});
  const [queue, setQueue] = useState<Cell[]>(cells);
  const [live, setLive] = useState<Cell | null>(null);
  const [picks, setPicks] = useState<string[]>([]);
  const sheetRef = useRef<HTMLCanvasElement>(null);

  const rendering = queue[0] ?? null;
  const stage = rendering ?? live ?? cells[0] ?? null;
  const done = cells.length - queue.length;

  const onShot = useCallback((url: string) => {
    setQueue((q) => {
      const head = q[0];
      if (head) setShots((s) => ({ ...s, [shotKey(head)]: url }));
      return q.slice(1);
    });
  }, []);

  const rerender = () => { setShots({}); setLive(null); setQueue(cells); };
  const togglePick = (id: string) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  // Compose the contact sheet once every shot is in. Columns are recipes,
  // rows are frames, each cell labelled with id + axes. A 2D canvas so the
  // capture script can read it back like any other.
  useEffect(() => {
    if (queue.length > 0 || !sheetRef.current) return;
    const cols = board.length;
    const rows = BOARD_FRAMES.length;
    const cw = 480; const ch = 300; const label = 34; const gap = 6;
    // Wrap into bands of five recipes: ten across makes a strip that has to be
    // shrunk below legibility to fit any screen, and a sheet you cannot read
    // is not a sheet. Each band carries its own L0 and L1 rows.
    const perRow = Math.min(cols, SHEET_PER_ROW);
    const bands = Math.ceil(cols / perRow);
    const c = sheetRef.current;
    c.width = perRow * (cw + gap) + gap;
    c.height = bands * rows * (ch + label + gap) + gap;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, c.width, c.height);
    board.forEach((recipe, col) => {
      BOARD_FRAMES.forEach((f, row) => {
        const url = shots[`${recipe.id}:${f.level}`];
        const band = Math.floor(col / perRow);
        const x = gap + (col % perRow) * (cw + gap);
        const y = gap + (band * rows + row) * (ch + label + gap);
        ctx.fillStyle = '#111317';
        ctx.fillRect(x, y, cw, ch + label);
        ctx.fillStyle = '#e6e2da';
        ctx.font = '600 15px ui-monospace, Consolas, monospace';
        ctx.fillText(`${recipe.id}  L${f.level}`, x + 10, y + ch + 22);
        ctx.fillStyle = '#9a9186';
        ctx.font = '13px ui-monospace, Consolas, monospace';
        ctx.fillText(axes.map((a) => `${a}=${recipe.axes[a] ?? '·'}`).join('  '), x + 130, y + ch + 22);
        if (!url) return;
        const img = new Image();
        img.onload = () => { ctx.drawImage(img, x, y, cw, ch); };
        img.src = url;
      });
    });
  }, [queue.length, shots, board, axes]);

  const levelLabel = (level: 0 | 1) => (level === 0 ? t.mastermind.board_level_l0 : t.mastermind.board_level_l1);

  return (
    <div className="mm-board" data-testid="mm-board">
      <header className="mm-board-head">
        <div className="mm-board-title">
          <span className="mm-board-mono">{board[0]?.id.split('-')[0] ?? 'b'}</span>
          <span className="mm-board-axes">{axes.join(' × ')}</span>
        </div>
        <div className="mm-board-status" role="status" aria-live="polite">
          {rendering
            ? tx(t.mastermind.board_rendering, { done, total: cells.length })
            : picks.length > 0
              ? `${t.mastermind.board_picks}: ${picks.join(', ')}`
              : t.mastermind.board_no_picks}
        </div>
        <button type="button" className="mm-board-btn" onClick={rerender} disabled={Boolean(rendering)}>
          {t.mastermind.board_rerender}
        </button>
      </header>

      {/* The stage: renders the queue, then shows the expanded cell live. */}
      <section className="mm-board-stage" style={{ width: STAGE_W, height: STAGE_H }} data-testid="mm-board-stage">
        {stage && (
          <Canvas
            key={`${shotKey(stage)}:${rendering ? 'shot' : 'live'}`}
            dpr={1}
            camera={{ fov: 42, near: 0.1, far: 400, position: [0, 12, 24] }}
            gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: true }}
          >
            <Suspense fallback={null}>
              <StrataScene world={MOCK_WORLD} nav={staticNav(stage.focus)} recipe={stage.recipe} interactive={!rendering} />
              {rendering && <Snapshot frames={SETTLE_FRAMES} onShot={onShot} />}
            </Suspense>
          </Canvas>
        )}
        {stage && (
          <div className="mm-board-stage-label mm-board-mono">
            {rendering ? '…' : t.mastermind.board_live} · {stage.recipe.id} · {stage.recipe.name} · {levelLabel(stage.level)}
          </div>
        )}
      </section>

      {/* The cells. */}
      <section className="mm-board-grid" style={{ gridTemplateColumns: `repeat(${board.length}, minmax(180px, 1fr))` }}>
        {board.map((recipe) => (
          <div key={recipe.id} className={`mm-board-col${picks.includes(recipe.id) ? ' mm-board-col--picked' : ''}`}>
            <div className="mm-board-col-head">
              <button type="button" className="mm-board-pick" aria-pressed={picks.includes(recipe.id)} onClick={() => togglePick(recipe.id)} data-testid={`mm-board-pick-${recipe.id}`}>
                {picks.includes(recipe.id) ? '★' : '☆'}
              </button>
              <span className="mm-board-mono mm-board-id">{recipe.id}</span>
              <span className="mm-board-mono mm-board-name">{recipe.name}</span>
            </div>
            {BOARD_FRAMES.map((f) => {
              const cell: Cell = { recipe, level: f.level, focus: f.focus };
              const url = shots[shotKey(cell)];
              const isLive = live && shotKey(live) === shotKey(cell);
              return (
                <button
                  key={f.level}
                  type="button"
                  className={`mm-board-cell${isLive ? ' mm-board-cell--live' : ''}`}
                  onClick={() => setLive(cell)}
                  disabled={!url}
                  data-testid={`mm-board-cell-${recipe.id}-${f.level}`}
                >
                  {url ? <img src={url} alt="" /> : <span className="mm-board-cell-ghost" />}
                  <span className="mm-board-cell-tag mm-board-mono">L{f.level}</span>
                </button>
              );
            })}
          </div>
        ))}
      </section>

      {/* The sheet — hidden until every shot is in; captured by the script. */}
      <section className="mm-board-sheet" hidden={queue.length > 0}>
        <p className="mm-board-hint">{t.mastermind.board_sheet_hint}</p>
        <canvas ref={sheetRef} data-testid="mm-board-sheet" />
      </section>
    </div>
  );
}
