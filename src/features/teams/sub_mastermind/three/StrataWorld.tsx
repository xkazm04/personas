// Variant A — STRATA. The Stark table: each project is a stack of four decks,
// one per dimension category, over a floor. Zooming a layer in EXPLODES the
// stack (the "Google Maps in many layers" ask made literal): L0 keeps the
// project closed, L1 opens it and lights the tiles on each deck, L2 keeps one
// deck and dims the rest.
//
// ROUND 2 — ten projects on a grid with a camera derived from its bounds;
// per-dimension labels mount only on the open project.
//
// ROUND 3 — the look is DATA: a DesignRecipe (board/recipes.ts) carries every
// knob. `StrataWorld` is the product tab and passes the shipped recipe; the
// design board mounts `StrataScene` with each candidate.
//
// ROUND 4 — the recipe chooses RENDERING MODES (physical / flat / wire, deck
// styles, floors, where status colour lives), not just numbers.
//
// ROUND 5 — the recipe chooses what a project IS at L0. Besides the shipped
// collapsed stack, a project can be a closed slab, a disc, or an upright card:
// a simple named body with no dimensions in sight, joined to its neighbours
// by lanes. Every body carries an `open` value the layer drives: 0 at L0, 1
// at L1 for the focused project. The body shrinks away as it opens and the
// decks rise out of it, so the transition — which is what this round is
// judged on — happens in front of the operator rather than between frames.
import { ContactShadows, Edges, Environment, Grid, Lightformer, MeshReflectorMaterial, OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';

import { useTranslation } from '@/i18n/useTranslation';

import { DIM_REGISTRY, type DimCategory } from '../lib/dimRegistry';

import { recipeToPalette, STRATA_RECIPE, type DesignRecipe, type NodeShape } from './board/recipes';
import { attentionDims, dimProgress, dimsByCategory, type World, type WorldDim, type WorldEdge, type WorldProject } from './mockWorld';
import type { WorldPalette } from './palettes';
import { arcPoints, at, CameraRig, damp, FlowLine, Halo, ORIGIN, Pulse, useHoverCursor, WorldLabel, type CameraPose, type Vec3 } from './sceneBits';
import type { WorldNav } from './useWorldNav';
import { categoryLabel, effectiveDim } from './WorldHud';
import { fitPortfolio, gridPositions, isDensePortfolio, worldBounds } from './worldLayout';
import { nodeEmphasis, nodeId } from './worldModel';

const DECK = 5.6;
const PLINTH = 6.6;
const GAP_COLLAPSED = 0.42;
const GAP_EXPLODED = 2.1;
const TILE_GAP = 1.05;
/** Centre-to-centre spacing on the portfolio grid. A stack is 6.6 wide, so
 *  this leaves a clear alley between neighbours at L0. */
const PROJECT_GAP = 11.5;

const deckY = (ci: number, gap: number): number => 0.5 + ci * gap;
const tileX = (i: number, count: number): number => (i - (count - 1) / 2) * TILE_GAP;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** How tall a closed body stands — the portfolio camera needs to know. */
function nodeHeight(shape: NodeShape): number {
  switch (shape) {
    case 'slab': return 1.5;
    case 'disc': return 0.7;
    case 'card': return 3.4;
    default: return deckY(3, GAP_COLLAPSED) + 0.6;
  }
}

function cameraPose(nav: WorldNav, world: World, pos: Record<string, Vec3>, fov: number, aspect: number, shape: NodeShape): CameraPose {
  const { focus } = nav.state;
  if (focus.level === 0 || !focus.project) {
    const bounds = worldBounds(world.projects.map((p) => at(pos, p.slug, ORIGIN)), PLINTH * 0.72);
    const fit = fitPortfolio(bounds, { fov, aspect, pitch: 40, contentHeight: nodeHeight(shape) + 0.8, margin: 1.1 });
    return { position: fit.position, target: fit.target };
  }
  const c = at(pos, focus.project, ORIGIN);
  if (focus.level === 1 || !focus.dim) return { position: [c[0] + 8, 9.5, c[2] + 13], target: [c[0], 3.4, c[2]] };
  const p = world.projects.find((x) => x.slug === focus.project);
  const groups = p ? dimsByCategory(p) : [];
  for (let ci = 0; ci < groups.length; ci++) {
    const dims = groups[ci]?.dims ?? [];
    const idx = dims.findIndex((d) => d.key === focus.dim);
    if (idx >= 0) {
      const t: Vec3 = [c[0] + tileX(idx, dims.length), deckY(ci, GAP_EXPLODED) + 0.4, c[2]];
      return { position: [t[0] + 4.2, t[1] + 3.4, t[2] + 6.4], target: t };
    }
  }
  return { position: [c[0] + 8, 9.5, c[2] + 13], target: [c[0], 3.4, c[2]] };
}

/** The product tab: the shipped recipe, interactive. */
export function StrataWorld({ world, nav }: { world: World; nav: WorldNav }) {
  return <StrataScene world={world} nav={nav} recipe={STRATA_RECIPE} interactive />;
}

/**
 * The scene itself, parameterised by a recipe. `interactive` mounts orbit
 * controls; the board leaves them off while it is rendering a frame to
 * snapshot, and on for the cell the operator is looking at.
 */
export function StrataScene({ world, nav, recipe, interactive }: { world: World; nav: WorldNav; recipe: DesignRecipe; interactive: boolean }) {
  const palette = useMemo(() => recipeToPalette(recipe), [recipe]);
  const pos = useMemo(() => gridPositions(world.projects.map((p) => p.slug), PROJECT_GAP), [world]);
  const aspect = useThree((s) => s.viewport.aspect);
  const fov = useThree((s) => (s.camera as THREE.PerspectiveCamera).fov ?? 42);
  const pose = cameraPose(nav, world, pos, fov, aspect, recipe.node.l0);
  const dense = isDensePortfolio(world.projects.length);
  const span = useMemo(() => worldBounds(world.projects.map((p) => at(pos, p.slug, ORIGIN)), PLINTH).radius, [world, pos]);
  const { ground, light, finish } = recipe;
  const tileGeometry = useTileGeometry(finish.bevel);

  return (
    <>
      <color attach="background" args={[ground.bg]} />
      {ground.fog && <fog attach="fog" args={[ground.bg, span * 1.2, span * 4.4]} />}
      <ToneMapping mode={light.tone} exposure={light.exposure} />
      <ambientLight intensity={light.ambient} />
      {light.key > 0 && <directionalLight position={light.keyFrom} intensity={light.key} color={light.keyColor} />}
      {light.fill > 0 && <directionalLight position={[-light.keyFrom[0], light.keyFrom[1] * 0.5, -light.keyFrom[2]]} intensity={light.fill} color={light.fillColor} />}
      {light.env !== 'none' && (
        <Environment resolution={64} frames={1}>
          <Lightformer form="rect" intensity={light.env === 'studio' ? 2.2 : 1.4} color={light.keyColor} position={[0, 12, 6]} scale={[18, 8, 1]} rotation={[-Math.PI / 2.4, 0, 0]} />
          <Lightformer form="rect" intensity={light.env === 'studio' ? 1.2 : 0.6} color={light.fillColor} position={[-12, 6, -10]} scale={[12, 6, 1]} rotation={[0, Math.PI / 3, 0]} />
          {light.env === 'studio' && (
            <Lightformer form="ring" intensity={1} color="#ffffff" position={[10, 8, 8]} scale={[6, 6, 1]} />
          )}
        </Environment>
      )}
      <Floor recipe={recipe} span={span} />
      {finish.contactShadow > 0 && (
        <ContactShadows position={[0, 0.005, 0]} scale={span * 2.6} blur={finish.shadowBlur} opacity={finish.contactShadow} far={9} resolution={512} frames={Infinity} />
      )}
      {interactive && (
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={span * 6} maxPolarAngle={Math.PI * 0.49} />
      )}
      <CameraRig pose={pose} flight={nav.state.flight} />

      {world.projects.map((p) => (
        <ProjectNode key={p.slug} project={p} center={at(pos, p.slug, ORIGIN)} nav={nav} palette={palette} recipe={recipe} dense={dense} tileGeometry={tileGeometry} />
      ))}

      {world.edges.map((e) => (
        <Lane key={`${e.from}-${e.to}`} edge={e} pos={pos} nav={nav} palette={palette} recipe={recipe} />
      ))}
    </>
  );
}

/** The floor under the recipe's floor kind. */
function Floor({ recipe, span }: { recipe: DesignRecipe; span: number }) {
  const { ground } = recipe;
  if (ground.floor === 'grid') {
    return (
      <Grid position={[0, -0.02, 0]} args={[80, 80]} cellSize={1.6} sectionSize={8} cellColor={ground.grid} sectionColor={ground.section} fadeDistance={span * 3.2} fadeStrength={1.3} infiniteGrid />
    );
  }
  if (ground.floor === 'plane') {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[span * 8, span * 8]} />
        {recipe.surface.mode === 'flat'
          ? <meshBasicMaterial color={ground.grid} />
          : <meshStandardMaterial color={ground.grid} roughness={1} metalness={0} />}
      </mesh>
    );
  }
  if (ground.floor === 'mirror') {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[span * 8, span * 8]} />
        <MeshReflectorMaterial blur={[400, 120]} resolution={1024} mixBlur={1} mixStrength={45} roughness={0.85} depthScale={1} minDepthThreshold={0.4} maxDepthThreshold={1.3} color={ground.grid} metalness={0.6} mirror={ground.mirror} />
      </mesh>
    );
  }
  return null;
}

/** Tone mapping is a RENDERER property; switching it recompiles materials. */
function ToneMapping({ mode, exposure }: { mode: DesignRecipe['light']['tone']; exposure: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    gl.toneMapping = mode === 'aces' ? THREE.ACESFilmicToneMapping : mode === 'neutral' ? THREE.NeutralToneMapping : THREE.NoToneMapping;
    gl.toneMappingExposure = exposure;
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) mat.needsUpdate = true;
    });
  }, [gl, scene, mode, exposure]);
  return null;
}

/** Outline colour for a cell under the recipe's edge tint; null = no outline. */
function edgeColor(recipe: DesignRecipe, palette: WorldPalette, own: string): string | null {
  switch (recipe.edges.tint) {
    case 'own': return own;
    case 'neutral': return recipe.edges.neutral;
    case 'primary': return palette.primary;
    case 'off': return null;
    default: return own;
  }
}

/** A surface under the recipe's rendering mode. `material` overrides pick a
 *  deck's own roughness/metalness/transmission over the tile profile. */
function Surface({ recipe, color, emissive = 0, opacity = 1, material }: {
  recipe: DesignRecipe;
  color: string;
  emissive?: number;
  opacity?: number;
  material?: { roughness: number; metalness: number; transmission?: number };
}) {
  const f = recipe.surface;
  const transparent = opacity < 1;
  const roughness = material?.roughness ?? f.roughness;
  const metalness = material?.metalness ?? f.metalness;
  const transmission = material?.transmission ?? 0;
  switch (f.mode) {
    case 'flat':
      return <meshBasicMaterial color={color} transparent={transparent} opacity={opacity} />;
    case 'wire':
      return <meshBasicMaterial color={color} transparent opacity={0.08 * opacity} depthWrite={false} />;
    default:
      return (
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={emissive}
          roughness={roughness}
          metalness={metalness}
          clearcoat={f.clearcoat}
          clearcoatRoughness={f.clearcoatRoughness}
          transmission={transmission}
          thickness={transmission > 0 ? 0.4 : 0}
          ior={1.45}
          transparent={transparent}
          opacity={opacity}
          depthWrite={!transparent}
        />
      );
  }
}

// ── Lanes ───────────────────────────────────────────────────────────────────

/** A relationship between two projects, in the recipe's lane style. Dashed
 *  lanes label themselves only when touched; ribbons and arcs are the point
 *  of their recipes and stay labelled at L0. */
function Lane({ edge, pos, nav, palette, recipe }: { edge: WorldEdge; pos: Record<string, Vec3>; nav: WorldNav; palette: WorldPalette; recipe: DesignRecipe }) {
  const a = pos[edge.from]; const b = pos[edge.to];
  const { hover, focus } = nav.state;
  const style = recipe.node.lanes;
  if (!a || !b) return null;
  const dx = b[0] - a[0]; const dz = b[2] - a[2];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len; const uz = dz / len;
  const inset = PLINTH / 2 + 0.15;
  const from: Vec3 = [a[0] + ux * inset, 0.2, a[2] + uz * inset];
  const to: Vec3 = [b[0] - ux * inset, 0.2, b[2] - uz * inset];
  const mid: Vec3 = [(from[0] + to[0]) / 2, 0.2, (from[2] + to[2]) / 2];
  const touched = hover === edge.from || hover === edge.to || focus.project === edge.from || focus.project === edge.to;
  const em = focus.level === 0 ? 1 : touched ? 0.9 : 0.22;
  const relation = edge.kind === 'relation';
  const color = relation ? palette.accent : palette.textDim;
  const labelled = style === 'dash' ? touched : focus.level === 0 || touched;
  const runLen = len - inset * 2;
  const yaw = Math.atan2(ux, uz);

  return (
    <group>
      {style === 'ribbon' && (
        <mesh position={[mid[0], 0.012, mid[2]]} rotation={[-Math.PI / 2, 0, -yaw]}>
          <planeGeometry args={[relation ? 0.9 : 0.5, runLen]} />
          <meshBasicMaterial color={color} transparent opacity={(relation ? 0.42 : 0.2) * em} depthWrite={false} />
        </mesh>
      )}
      {style === 'arc' ? (
        <FlowLine points={arcPoints(from, to, Math.min(3.5, runLen * 0.22))} color={color} opacity={(relation ? 0.7 : 0.35) * em} width={relation ? 1.8 : 1.1} dashSize={0.5} gapSize={0.3} speed={relation ? 0.8 : 0.3} />
      ) : (
        <FlowLine
          points={[from, to]}
          color={color}
          opacity={(relation ? (style === 'ribbon' ? 0.9 : 0.6) : 0.35) * em}
          width={relation ? 1.8 : 1.1}
          dashSize={relation ? 0.5 : 0.22}
          gapSize={0.3}
          speed={relation ? 0.9 : 0.3}
        />
      )}
      {relation && <Pulse points={style === 'arc' ? arcPoints(from, to, Math.min(3.5, runLen * 0.22)) : [from, to]} color={color} size={0.09} period={3.4} />}
      {labelled && (
        <WorldLabel position={style === 'arc' ? [mid[0], mid[1] + Math.min(3.5, runLen * 0.22), mid[2]] : mid} opacity={em} offset={[0, -16]}>
          <span className="mm3d-label mm3d-label-edge">{edge.label}</span>
        </WorldLabel>
      )}
    </group>
  );
}

// ── Project bodies ──────────────────────────────────────────────────────────

/**
 * One project. Owns the `open` value — 0 closed at L0, 1 open at L1 for the
 * focused project — that both the closed body and the decks read: the body
 * flattens and fades as it opens, the decks rise out of it. For the shipped
 * `stack` shape the body IS the collapsed decks, so nothing extra is drawn.
 */
function ProjectNode({ project, center, nav, palette, recipe, dense, tileGeometry }: { project: WorldProject; center: Vec3; nav: WorldNav; palette: WorldPalette; recipe: DesignRecipe; dense: boolean; tileGeometry: THREE.BufferGeometry }) {
  const { t } = useTranslation();
  const { focus, hover } = nav.state;
  const mine = focus.project === project.slug;
  const exploded = focus.level >= 1 && mine;
  const em = nodeEmphasis(focus, project.slug, null);
  const id = nodeId(project.slug);
  const hovered = hover === id;
  useHoverCursor(hovered);
  const groups = useMemo(() => dimsByCategory(project), [project]);
  const attention = useMemo(() => attentionDims(project).length, [project]);
  const shape = recipe.node.l0;
  const closedBody = shape !== 'stack';
  const open = useRef(exploded ? 1 : 0);
  const decks = useRef<Array<THREE.Group | null>>([]);
  const deckRoot = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const stateColor = palette.state[project.state];
  const f = palette.frost;
  const plinthEdge = edgeColor(recipe, palette, stateColor);

  useFrame((_, dt) => {
    open.current = damp(open.current, exploded ? 1 : 0, 5, dt);
    const o = open.current;
    const gap = lerp(GAP_COLLAPSED, GAP_EXPLODED, o);
    decks.current.forEach((g, ci) => { if (g) g.position.y = deckY(ci, gap); });
    if (closedBody) {
      // The decks live inside the body until it opens: scaled to nothing at
      // L0, full size at L1. The body does the reverse.
      const s = Math.max(0.001, o);
      deckRoot.current?.scale.set(s, s, s);
      if (body.current) {
        const bs = Math.max(0.001, 1 - o);
        body.current.scale.set(1, bs, 1);
        body.current.visible = bs > 0.01;
      }
    }
  });

  const labelY = closedBody ? nodeHeight(shape) + 0.6 : deckY(groups.length - 1, exploded ? GAP_EXPLODED : GAP_COLLAPSED) + 1.2;

  return (
    <group position={center}>
      {/* plinth */}
      <mesh
        position={[0, 0.08, 0]}
        onClick={(e) => { e.stopPropagation(); nav.openProject(project.slug); }}
        onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }}
        onPointerOut={() => nav.hover(null)}
      >
        <boxGeometry args={[PLINTH, 0.16, PLINTH]} />
        <Surface recipe={recipe} color={palette.structure} opacity={recipe.surface.mode === 'wire' ? 0.5 : 1} material={{ roughness: 0.88, metalness: 0.12 }} />
        {plinthEdge && <Edges color={hovered ? palette.primary : plinthEdge} lineWidth={hovered ? 1.4 : Math.max(0.6, recipe.edges.weight)} />}
      </mesh>
      {/* state light strip on the plinth's front edge — the one place a solid
          colour sits at full strength, because it IS the readout */}
      <mesh position={[0, 0.17, PLINTH / 2 - 0.08]}>
        <boxGeometry args={[PLINTH - 0.4, 0.03, 0.08]} />
        <meshBasicMaterial color={stateColor} />
      </mesh>
      {f.halo > 0 && <Halo color={stateColor} size={PLINTH * 1.1} opacity={f.halo * em} position={[0, 0.28, 0]} />}

      {closedBody && (
        <group ref={body} position={[0, 0.16, 0]}>
          <ClosedBody shape={shape} recipe={recipe} palette={palette} project={project} hovered={hovered} onOpen={() => nav.openProject(project.slug)} onHover={(h) => nav.hover(h ? id : null)} />
        </group>
      )}

      <WorldLabel position={[0, labelY, 0]} opacity={em} interactive>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openProject(project.slug)}>
          <span className={`mm3d-label mm3d-label-project${closedBody ? ' mm3d-label-project--hero' : dense && !mine ? ' mm3d-label-project--dense' : ''}`}>
            {project.name}
            <span className="mm3d-label-tag">
              {project.tag} · {project.state}
              {attention > 0 && (
                <b className="mm3d-label-attn" style={{ color: palette.status.risk }}> · {attention}</b>
              )}
            </span>
          </span>
        </button>
      </WorldLabel>

      <group ref={deckRoot} scale={closedBody && !exploded ? 0.001 : 1}>
        {groups.map((g, ci) => (
          <group key={g.category} ref={(el) => { decks.current[ci] = el; }} position={[0, deckY(ci, exploded ? GAP_EXPLODED : GAP_COLLAPSED), 0]}>
            <Deck
              project={project}
              category={g.category}
              dims={g.dims}
              nav={nav}
              palette={palette}
              recipe={recipe}
              exploded={exploded}
              label={categoryLabel(t, g.category)}
              tileGeometry={tileGeometry}
            />
          </group>
        ))}
      </group>
    </group>
  );
}

/** The closed L0 body of a project, in the recipe's shape. Sits on the plinth;
 *  the parent scales it away as the project opens. */
function ClosedBody({ shape, recipe, palette, project, hovered, onOpen, onHover }: {
  shape: NodeShape;
  recipe: DesignRecipe;
  palette: WorldPalette;
  project: WorldProject;
  hovered: boolean;
  onOpen: () => void;
  onHover: (h: boolean) => void;
}) {
  const stateColor = palette.state[project.state];
  const color = recipe.deck.color;
  const material = { roughness: recipe.deck.roughness, metalness: recipe.deck.metalness };
  const outline = recipe.edges.tint === 'off' ? null : hovered ? palette.primary : palette.primary;
  const handlers = {
    onClick: (e: { stopPropagation: () => void }) => { e.stopPropagation(); onOpen(); },
    onPointerOver: (e: { stopPropagation: () => void }) => { e.stopPropagation(); onHover(true); },
    onPointerOut: () => onHover(false),
  };
  if (shape === 'slab') {
    const h = nodeHeight('slab');
    return (
      <group>
        <mesh position={[0, h / 2, 0]} {...handlers}>
          <boxGeometry args={[DECK, h, DECK]} />
          <Surface recipe={recipe} color={color} opacity={Math.max(0.55, recipe.deck.opacity)} material={material} />
          {outline && <Edges color={outline} lineWidth={0.8} />}
        </mesh>
        {/* four hairlines where the decks will split apart */}
        {[1, 2, 3].map((i) => (
          <mesh key={i} position={[0, (h * i) / 4, 0]}>
            <boxGeometry args={[DECK + 0.02, 0.012, DECK + 0.02]} />
            <meshBasicMaterial color={palette.primary} transparent opacity={0.35} />
          </mesh>
        ))}
        {/* a state badge inlaid in the top face */}
        <mesh position={[0, h + 0.008, 0]}>
          <boxGeometry args={[DECK * 0.42, 0.016, DECK * 0.42]} />
          <meshBasicMaterial color={stateColor} transparent opacity={0.85} />
        </mesh>
      </group>
    );
  }
  if (shape === 'disc') {
    const h = nodeHeight('disc');
    const r = PLINTH * 0.42;
    return (
      <group>
        <mesh position={[0, h / 2, 0]} {...handlers}>
          <cylinderGeometry args={[r, r * 1.04, h, 48]} />
          <Surface recipe={recipe} color={color} opacity={Math.max(0.6, recipe.deck.opacity)} material={material} />
        </mesh>
        <mesh position={[0, h + 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[r * 0.86, r * 0.96, 64]} />
          <meshBasicMaterial color={stateColor} transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
        <mesh position={[0, h + 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[r * 0.4, 48]} />
          <meshBasicMaterial color={palette.primary} transparent opacity={0.25} side={THREE.DoubleSide} />
        </mesh>
      </group>
    );
  }
  // card — an upright plate at the back of the plinth, leaning back a little
  const h = nodeHeight('card');
  return (
    <group position={[0, 0, -PLINTH * 0.3]} rotation={[-0.16, 0, 0]}>
      <mesh position={[0, h / 2, 0]} {...handlers}>
        <boxGeometry args={[DECK, h, 0.28]} />
        <Surface recipe={recipe} color={color} opacity={Math.max(0.7, recipe.deck.opacity)} material={material} />
        {outline && <Edges color={outline} lineWidth={0.8} />}
      </mesh>
      <mesh position={[0, h - 0.18, 0.15]}>
        <boxGeometry args={[DECK - 0.5, 0.12, 0.02]} />
        <meshBasicMaterial color={stateColor} />
      </mesh>
      <mesh position={[0, h * 0.42, 0.15]}>
        <boxGeometry args={[DECK - 1.2, 0.04, 0.02]} />
        <meshBasicMaterial color={palette.primary} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function Deck({ project, category, dims, nav, palette, recipe, exploded, label, tileGeometry }: {
  project: WorldProject;
  category: DimCategory;
  dims: WorldDim[];
  nav: WorldNav;
  palette: WorldPalette;
  recipe: DesignRecipe;
  exploded: boolean;
  label: string;
  tileGeometry: THREE.BufferGeometry;
}) {
  const { focus } = nav.state;
  const focusedHere = focus.level === 2 && focus.project === project.slug && dims.some((d) => d.key === focus.dim);
  const ghost = focus.level === 2 && focus.project === project.slug && !focusedHere;
  const { deck } = recipe;
  const style = recipe.surface.mode === 'wire' && deck.style !== 'none' ? 'frame' : deck.style;
  const fade = ghost ? 0.3 : exploded ? 1 : 0.75;
  const deckEdge = style === 'frame'
    ? (focusedHere ? palette.accent : deck.color)
    : recipe.edges.tint === 'off' ? null : focusedHere ? palette.accent : palette.primary;
  const labelInk = deckEdge ?? palette.primary;
  return (
    <group>
      {style !== 'none' && (
        <mesh onClick={(e) => { e.stopPropagation(); nav.openProject(project.slug); }}>
          <boxGeometry args={[DECK, 0.06, DECK]} />
          {/* A solid deck is OPAQUE, full stop: at 0.96 it went transparent,
              lost depth-write, and the middle decks of a stack rendered dark
              grey through the sort order. Only a slab uses deck.opacity. */}
          {style === 'frame'
            ? <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            : <Surface recipe={recipe} color={deck.color} opacity={style === 'solid' ? 1 : Math.min(1, deck.opacity * fade)} material={{ roughness: deck.roughness, metalness: deck.metalness, transmission: deck.transmission }} />}
          {deckEdge && (
            <Edges color={deckEdge} lineWidth={focusedHere ? 1.5 : Math.max(0.6, recipe.edges.weight + 0.2)} transparent opacity={style === 'frame' || exploded ? 1 : 0.3} />
          )}
        </mesh>
      )}
      {exploded && !ghost && (
        <WorldLabel position={[-DECK / 2 + 0.2, 0.05, DECK / 2 - 0.2]} opacity={1} offset={[-10, -6]}>
          <span className="mm3d-label mm3d-label-dim mm3d-caps" style={{ '--w-dot': labelInk, color: labelInk } as React.CSSProperties}>{label}</span>
        </WorldLabel>
      )}
      {dims.map((raw, i) => {
        const d = effectiveDim(nav, project.slug, raw);
        return (
          <Tile
            key={d.key}
            project={project}
            dim={d}
            x={tileX(i, dims.length)}
            nav={nav}
            palette={palette}
            recipe={recipe}
            exploded={exploded}
            emphasis={nodeEmphasis(focus, project.slug, d.key)}
            category={category}
            geometry={tileGeometry}
          />
        );
      })}
    </group>
  );
}

const TILE_W = 0.82;

/** ONE tile geometry per mounted scene, owned by the scene and disposed with it. */
function useTileGeometry(bevel: number): THREE.BufferGeometry {
  const geometry = useMemo(
    () => (bevel > 0 ? new RoundedBoxGeometry(TILE_W, 1, TILE_W, 3, bevel) : new THREE.BoxGeometry(TILE_W, 1, TILE_W)),
    [bevel],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return geometry;
}

function Tile({ project, dim, x, nav, palette, recipe, exploded, emphasis, geometry }: {
  project: WorldProject;
  dim: WorldDim;
  x: number;
  nav: WorldNav;
  palette: WorldPalette;
  recipe: DesignRecipe;
  exploded: boolean;
  emphasis: number;
  category: DimCategory;
  geometry: THREE.BufferGeometry;
}) {
  const id = nodeId(project.slug, dim.key);
  const hovered = nav.state.hover === id;
  const focused = nav.state.focus.dim === dim.key && nav.state.focus.project === project.slug;
  const pointed = nav.state.highlight.has(id);
  useHoverCursor(hovered);
  const color = palette.status[dim.status];
  const f = palette.frost;
  const s = recipe.surface;
  const h = exploded ? 0.16 + dimProgress(dim) * 0.7 : 0.1;
  const mesh = useRef<THREE.Mesh>(null);
  const cur = useRef(0.1);
  const Icon = DIM_REGISTRY[dim.key].icon;
  const outline = edgeColor(recipe, palette, color);
  const trouble = dim.status === 'risk' || dim.status === 'alert';
  const cap = recipe.finish.statusAs === 'cap';
  const bodyColor = cap ? s.bodyColor : color;
  const emissive = cap ? 0 : trouble && s.attentionGlow > 0 ? s.attentionGlow : dim.status === 'absent' ? f.emissiveMuted : f.emissive;
  const opacity = s.opaqueTiles || s.mode !== 'physical' ? 1 : 0.4 + emphasis * 0.6;

  useFrame((_, dt) => {
    if (!mesh.current) return;
    cur.current = damp(cur.current, h * (focused ? 1.5 : hovered ? 1.2 : 1), 7, dt);
    mesh.current.scale.y = cur.current;
    mesh.current.position.y = 0.03 + cur.current / 2;
  });

  return (
    <group position={[x, 0, 0]}>
      <mesh
        ref={mesh}
        geometry={geometry}
        onClick={(e) => { e.stopPropagation(); nav.openDim(project.slug, dim.key); }}
        onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }}
        onPointerOut={() => nav.hover(null)}
      >
        <Surface recipe={recipe} color={bodyColor} emissive={emissive} opacity={opacity} />
        {outline && <Edges color={outline} lineWidth={recipe.edges.weight} />}
        {cap && (
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[TILE_W + 0.02, 0.06, TILE_W + 0.02]} />
            <Surface recipe={recipe} color={color} emissive={trouble ? s.attentionGlow : f.emissive} />
          </mesh>
        )}
      </mesh>
      {pointed && <Halo color={palette.accent} size={2.6} opacity={Math.max(f.halo, 0.12) * 2.4} position={[0, 0.6, 0]} />}
      {focused && f.halo > 0 && <Halo color={color} size={2.2} opacity={f.halo * 1.8} position={[0, 0.7, 0]} />}
      {trouble && s.attentionGlow > 0 && <Halo color={color} size={1.6 + dimProgress(dim)} opacity={0.35} position={[0, 0.5 + h * 0.5, 0]} />}
      {exploded && (
        <WorldLabel position={[0, 0.2 + h, 0]} opacity={emphasis} interactive offset={[0, -14]}>
          <button type="button" className="mm3d-label-btn" onClick={() => nav.openDim(project.slug, dim.key)} style={{ '--w-dot': color } as React.CSSProperties}>
            <span className="mm3d-label mm3d-label-dim" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <Icon size={10} color={color} aria-hidden />
              {DIM_REGISTRY[dim.key].label}
            </span>
          </button>
        </WorldLabel>
      )}
      {focused && (
        <WorldLabel position={[0, 0.9, 0]} opacity={1} offset={[110, 0]}>
          <div className="mm3d-readout" style={{ '--w-dot': color } as React.CSSProperties}>
            <b>{DIM_REGISTRY[dim.key].label}</b><br />
            {dim.detail ?? '—'}<br />
            {dim.figure ?? ''}
          </div>
        </WorldLabel>
      )}
    </group>
  );
}
