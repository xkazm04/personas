// Variant A — STRATA. The Stark table: each project is a stack of four glass
// decks, one per dimension category, hovering over a graphite floor. Zooming a
// layer in EXPLODES the stack (the "Google Maps in many layers" ask made
// literal): L0 keeps the decks collapsed into a compact block, L1 spreads them
// apart and lights the tiles on each deck, L2 keeps one deck and dims the rest
// to glass.
//
// ROUND 2 — ten projects instead of two, frosted instead of neon:
//   • the portfolio lays itself out on a centred grid (worldLayout) and the L0
//     camera is DERIVED from that grid's real bounds, so the tenth project
//     changes the framing by itself;
//   • every surface is a rough, barely-emissive physical material lit by the
//     scene, so the stacks read as frosted glass rather than as light sources;
//   • per-dimension labels MOUNT ONLY on the exploded project. They are drei
//     <Html> portals — one React root each — and ten projects would otherwise
//     put 150 of them in the DOM to render at opacity 0.
//
// ROUND 3 — the look is DATA. Everything that decides how this world looks
// (ground, light, surface, edges, ramp, finish) now arrives as a DesignRecipe
// (board/recipes.ts). `StrataWorld` is the product tab and passes the shipped
// recipe; the design board mounts `StrataScene` directly with each candidate.
// Nothing about the scene's structure changed — only where its numbers live.
import { ContactShadows, Edges, Environment, Grid, Lightformer, OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three-stdlib';

import { useTranslation } from '@/i18n/useTranslation';

import { DIM_REGISTRY, type DimCategory } from '../lib/dimRegistry';

import { recipeToPalette, STRATA_RECIPE, type DesignRecipe } from './board/recipes';
import { attentionDims, dimProgress, dimsByCategory, type World, type WorldDim, type WorldEdge, type WorldProject } from './mockWorld';
import type { WorldPalette } from './palettes';
import { at, CameraRig, damp, FlowLine, Halo, ORIGIN, Pulse, useHoverCursor, WorldLabel, type CameraPose, type Vec3 } from './sceneBits';
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

function cameraPose(nav: WorldNav, world: World, pos: Record<string, Vec3>, fov: number, aspect: number): CameraPose {
  const { focus } = nav.state;
  if (focus.level === 0 || !focus.project) {
    const bounds = worldBounds(world.projects.map((p) => at(pos, p.slug, ORIGIN)), PLINTH * 0.72);
    const fit = fitPortfolio(bounds, { fov, aspect, pitch: 40, contentHeight: deckY(3, GAP_COLLAPSED) + 1.4, margin: 1.1 });
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
 * snapshot, and on for the cell the operator has expanded.
 */
export function StrataScene({ world, nav, recipe, interactive }: { world: World; nav: WorldNav; recipe: DesignRecipe; interactive: boolean }) {
  const palette = useMemo(() => recipeToPalette(recipe), [recipe]);
  const pos = useMemo(() => gridPositions(world.projects.map((p) => p.slug), PROJECT_GAP), [world]);
  const aspect = useThree((s) => s.viewport.aspect);
  const fov = useThree((s) => (s.camera as THREE.PerspectiveCamera).fov ?? 42);
  const pose = cameraPose(nav, world, pos, fov, aspect);
  const dense = isDensePortfolio(world.projects.length);
  const span = useMemo(() => worldBounds(world.projects.map((p) => at(pos, p.slug, ORIGIN)), PLINTH).radius, [world, pos]);
  const { ground, light, finish } = recipe;

  return (
    <>
      <color attach="background" args={[ground.bg]} />
      {ground.fog && <fog attach="fog" args={[ground.bg, span * 1.2, span * 4.4]} />}
      <ToneMapping mode={light.tone} exposure={light.exposure} />
      {/* Frosted surfaces need light to shade, not emission to glow: a key, a
          fill, and (optionally) a small local environment for clearcoat to catch. */}
      <ambientLight intensity={light.ambient} />
      <directionalLight position={[14, 22, 10]} intensity={light.key} color={light.keyColor} />
      <directionalLight position={[-16, 10, -12]} intensity={light.fill} color={light.fillColor} />
      {light.env !== 'none' && (
        <Environment resolution={64} frames={1}>
          <Lightformer form="rect" intensity={light.env === 'studio' ? 2.2 : 1.4} color={light.keyColor} position={[0, 12, 6]} scale={[18, 8, 1]} rotation={[-Math.PI / 2.4, 0, 0]} />
          <Lightformer form="rect" intensity={light.env === 'studio' ? 1.2 : 0.6} color={light.fillColor} position={[-12, 6, -10]} scale={[12, 6, 1]} rotation={[0, Math.PI / 3, 0]} />
          {light.env === 'studio' && (
            <Lightformer form="ring" intensity={1} color="#ffffff" position={[10, 8, 8]} scale={[6, 6, 1]} />
          )}
        </Environment>
      )}
      {ground.floor === 'grid' && (
        <Grid
          position={[0, -0.02, 0]}
          args={[80, 80]}
          cellSize={1.6}
          sectionSize={8}
          cellColor={ground.grid}
          sectionColor={ground.section}
          fadeDistance={span * 3.2}
          fadeStrength={1.3}
          infiniteGrid
        />
      )}
      {ground.floor === 'plane' && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <planeGeometry args={[span * 8, span * 8]} />
          <meshStandardMaterial color={ground.grid} roughness={1} metalness={0} />
        </mesh>
      )}
      {/* Contact shadows are what ground the stacks: without them a matte,
          desaturated scene reads as flat rather than calm. Re-rendered every
          frame because the exploded decks move. */}
      {finish.contactShadow > 0 && (
        <ContactShadows position={[0, 0.005, 0]} scale={span * 2.6} blur={finish.shadowBlur} opacity={finish.contactShadow} far={9} resolution={512} frames={Infinity} />
      )}
      {interactive && (
        <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={span * 6} maxPolarAngle={Math.PI * 0.49} />
      )}
      <CameraRig pose={pose} flight={nav.state.flight} />

      {world.projects.map((p) => (
        <DeckStack key={p.slug} project={p} center={at(pos, p.slug, ORIGIN)} nav={nav} palette={palette} recipe={recipe} dense={dense} />
      ))}

      {world.edges.map((e) => (
        <Beam key={`${e.from}-${e.to}`} edge={e} pos={pos} nav={nav} palette={palette} />
      ))}
    </>
  );
}

/**
 * Tone mapping is a RENDERER property, not a material one, and R3F's default
 * is filmic (ACES), which desaturates and crushes exactly the soft tones a
 * matte look depends on. Switching it needs every material recompiled, hence
 * the traverse.
 */
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

/** Ground-level beam between two plinths. Its label appears only when one of
 *  its ends is hovered or open — eight always-on labels is clutter at L0. */
function Beam({ edge, pos, nav, palette }: { edge: WorldEdge; pos: Record<string, Vec3>; nav: WorldNav; palette: WorldPalette }) {
  const a = pos[edge.from]; const b = pos[edge.to];
  const { hover, focus } = nav.state;
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
  const color = edge.kind === 'similarity' ? palette.textDim : palette.accent;
  return (
    <group>
      <FlowLine
        points={[from, to]}
        color={color}
        opacity={(edge.kind === 'similarity' ? 0.35 : 0.6) * em}
        width={edge.kind === 'similarity' ? 1.1 : 1.8}
        dashSize={edge.kind === 'similarity' ? 0.22 : 0.5}
        gapSize={0.3}
        speed={edge.kind === 'similarity' ? 0.3 : 0.9}
      />
      {edge.kind === 'relation' && <Pulse points={[from, to]} color={color} size={0.09} period={3.4} />}
      {touched && (
        <WorldLabel position={mid} opacity={1} offset={[0, -16]}>
          <span className="mm3d-label mm3d-label-edge">{edge.label}</span>
        </WorldLabel>
      )}
    </group>
  );
}

function DeckStack({ project, center, nav, palette, recipe, dense }: { project: WorldProject; center: Vec3; nav: WorldNav; palette: WorldPalette; recipe: DesignRecipe; dense: boolean }) {
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
  const gap = useRef(GAP_COLLAPSED);
  const decks = useRef<Array<THREE.Group | null>>([]);
  const stateColor = palette.state[project.state];
  const f = palette.frost;
  const plinthEdge = edgeColor(recipe, palette, stateColor);

  useFrame((_, dt) => {
    gap.current = damp(gap.current, exploded ? GAP_EXPLODED : GAP_COLLAPSED, 6, dt);
    decks.current.forEach((g, ci) => { if (g) g.position.y = deckY(ci, gap.current); });
  });

  const topY = deckY(groups.length - 1, exploded ? GAP_EXPLODED : GAP_COLLAPSED) + 1.2;

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
        <meshPhysicalMaterial color={palette.structure} roughness={0.88} metalness={0.12} clearcoat={0.16} clearcoatRoughness={0.8} />
        {plinthEdge && <Edges color={hovered ? palette.primary : plinthEdge} lineWidth={hovered ? 1.4 : 1} />}
      </mesh>
      {/* state light strip on the plinth's front edge — the one place a solid
          colour sits at full strength, because it IS the readout */}
      <mesh position={[0, 0.17, PLINTH / 2 - 0.08]}>
        <boxGeometry args={[PLINTH - 0.4, 0.03, 0.08]} />
        <meshBasicMaterial color={stateColor} />
      </mesh>
      <Halo color={stateColor} size={PLINTH * 1.1} opacity={f.halo * em} position={[0, 0.28, 0]} />

      <WorldLabel position={[0, topY, 0]} opacity={em} interactive>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openProject(project.slug)}>
          <span className={`mm3d-label mm3d-label-project${dense && !mine ? ' mm3d-label-project--dense' : ''}`}>
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

      {groups.map((g, ci) => (
        <group key={g.category} ref={(el) => { decks.current[ci] = el; }} position={[0, deckY(ci, GAP_COLLAPSED), 0]}>
          <Deck
            project={project}
            category={g.category}
            dims={g.dims}
            nav={nav}
            palette={palette}
            recipe={recipe}
            exploded={exploded}
            label={categoryLabel(t, g.category)}
          />
        </group>
      ))}
    </group>
  );
}

function Deck({ project, category, dims, nav, palette, recipe, exploded, label }: {
  project: WorldProject;
  category: DimCategory;
  dims: WorldDim[];
  nav: WorldNav;
  palette: WorldPalette;
  recipe: DesignRecipe;
  exploded: boolean;
  label: string;
}) {
  const { focus } = nav.state;
  const focusedHere = focus.level === 2 && focus.project === project.slug && dims.some((d) => d.key === focus.dim);
  const ghost = focus.level === 2 && focus.project === project.slug && !focusedHere;
  const f = palette.frost;
  const slab = ghost ? f.slab * 0.3 : exploded ? f.slab : f.slab * 0.75;
  const deckEdge = recipe.edges.tint === 'off' ? null : focusedHere ? palette.accent : palette.primary;
  return (
    <group>
      <mesh onClick={(e) => { e.stopPropagation(); nav.openProject(project.slug); }}>
        <boxGeometry args={[DECK, 0.06, DECK]} />
        <meshPhysicalMaterial
          color={palette.glass}
          transparent
          opacity={slab}
          roughness={f.roughness}
          metalness={f.metalness}
          clearcoat={f.clearcoat}
          clearcoatRoughness={f.clearcoatRoughness}
          depthWrite={false}
        />
        {/* Four outlines per project times ten projects is a lot of repeated
            rectangle at L0, so the deck edges recede until the stack opens. */}
        {deckEdge && <Edges color={deckEdge} lineWidth={focusedHere ? 1.5 : recipe.edges.weight + 0.2} transparent opacity={exploded ? 1 : 0.3} />}
      </mesh>
      {exploded && !ghost && (
        <WorldLabel position={[-DECK / 2 + 0.2, 0.05, DECK / 2 - 0.2]} opacity={1} offset={[-10, -6]}>
          <span className="mm3d-label mm3d-label-dim mm3d-caps" style={{ '--w-dot': deckEdge ?? palette.primary, color: deckEdge ?? palette.primary } as React.CSSProperties}>{label}</span>
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
          />
        );
      })}
    </group>
  );
}

const TILE_W = 0.82;

/** A tile's geometry under the recipe's bevel — shared per bevel value, since
 *  150 tiles need not each own one. */
const tileGeometryCache = new Map<number, THREE.BufferGeometry>();
function tileGeometry(bevel: number): THREE.BufferGeometry {
  let g = tileGeometryCache.get(bevel);
  if (!g) {
    g = bevel > 0 ? new RoundedBoxGeometry(TILE_W, 1, TILE_W, 3, bevel) : new THREE.BoxGeometry(TILE_W, 1, TILE_W);
    tileGeometryCache.set(bevel, g);
  }
  return g;
}

function Tile({ project, dim, x, nav, palette, recipe, exploded, emphasis }: {
  project: WorldProject;
  dim: WorldDim;
  x: number;
  nav: WorldNav;
  palette: WorldPalette;
  recipe: DesignRecipe;
  exploded: boolean;
  emphasis: number;
  category: DimCategory;
}) {
  const id = nodeId(project.slug, dim.key);
  const hovered = nav.state.hover === id;
  const focused = nav.state.focus.dim === dim.key && nav.state.focus.project === project.slug;
  const pointed = nav.state.highlight.has(id);
  useHoverCursor(hovered);
  const color = palette.status[dim.status];
  const f = palette.frost;
  const h = exploded ? 0.16 + dimProgress(dim) * 0.7 : 0.1;
  const mesh = useRef<THREE.Mesh>(null);
  const cur = useRef(0.1);
  const Icon = DIM_REGISTRY[dim.key].icon;
  const geometry = useMemo(() => tileGeometry(recipe.finish.bevel), [recipe.finish.bevel]);
  const outline = edgeColor(recipe, palette, color);
  const opaque = recipe.surface.opaqueTiles;

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
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={dim.status === 'absent' ? f.emissiveMuted : f.emissive}
          roughness={f.roughness}
          metalness={f.metalness}
          clearcoat={f.clearcoat}
          clearcoatRoughness={f.clearcoatRoughness}
          transmission={recipe.surface.transmission}
          transparent={!opaque}
          opacity={opaque ? 1 : 0.4 + emphasis * 0.6}
        />
        {outline && <Edges color={outline} lineWidth={recipe.edges.weight} />}
      </mesh>
      {pointed && <Halo color={palette.accent} size={2.6} opacity={f.halo * 2.4} position={[0, 0.6, 0]} />}
      {focused && <Halo color={color} size={2.2} opacity={f.halo * 1.8} position={[0, 0.7, 0]} />}
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
