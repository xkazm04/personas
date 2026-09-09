// Variant B — STRATA. The Stark table: each project is a stack of four glass
// decks, one per dimension category, hovering over a graphite grid. Zooming a
// layer in EXPLODES the stack (the "Google Maps in many layers" ask made
// literal): L0 keeps the decks collapsed into a compact block, L1 spreads them
// apart and lights the tiles on each deck, L2 keeps one deck and dims the rest
// to glass.
//
// Amber on graphite with a cyan counter-accent; wide geometric caps.
import { Edges, Grid, OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import { DIM_REGISTRY, type DimCategory } from '../lib/dimRegistry';

import { dimProgress, dimsByCategory, type World, type WorldDim, type WorldProject } from './mockWorld';
import { STRATA, type WorldPalette } from './palettes';
import { at, CameraRig, damp, fitFactor, FlowLine, Halo, ORIGIN, pullBack, Pulse, useHoverCursor, WorldLabel, type CameraPose, type Vec3 } from './sceneBits';
import type { WorldNav } from './useWorldNav';
import { categoryLabel, effectiveDim } from './WorldHud';
import { nodeEmphasis, nodeId } from './worldModel';
import { useTranslation } from '@/i18n/useTranslation';

const DECK = 5.6;
const PLINTH = 6.6;
const GAP_COLLAPSED = 0.42;
const GAP_EXPLODED = 2.1;
const TILE_GAP = 1.05;
const PROJECT_GAP = 19;

function projectPositions(world: World): Record<string, Vec3> {
  const n = world.projects.length;
  const out: Record<string, Vec3> = {};
  world.projects.forEach((p, i) => { out[p.slug] = [(i - (n - 1) / 2) * PROJECT_GAP, 0, 0]; });
  return out;
}

const deckY = (ci: number, gap: number): number => 0.5 + ci * gap;
const tileX = (i: number, count: number): number => (i - (count - 1) / 2) * TILE_GAP;

function cameraPose(nav: WorldNav, world: World, pos: Record<string, Vec3>): CameraPose {
  const { focus } = nav.state;
  if (focus.level === 0 || !focus.project) return { position: [0, 15, 27], target: [0, 1.2, 0] };
  const c = pos[focus.project] ?? [0, 0, 0];
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

export function StrataWorld({ world, nav }: { world: World; nav: WorldNav }) {
  const palette = STRATA;
  const pos = useMemo(() => projectPositions(world), [world]);
  const aspect = useThree((s) => s.viewport.aspect);
  const raw = cameraPose(nav, world, pos);
  const pose = nav.state.focus.level === 0 ? pullBack(raw, fitFactor(aspect)) : raw;
  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.fog ?? palette.bg, 28, 95]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[8, 18, 6]} intensity={0.55} color="#fff2dc" />
      <pointLight position={[0, 6, 0]} intensity={0.6} color={palette.primary} distance={40} />
      <Grid
        position={[0, -0.02, 0]}
        args={[80, 80]}
        cellSize={1}
        sectionSize={5}
        cellColor={palette.grid}
        sectionColor="#4a3d22"
        fadeDistance={48}
        fadeStrength={1.4}
        infiniteGrid
      />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={70} maxPolarAngle={Math.PI * 0.49} />
      <CameraRig pose={pose} flight={nav.state.flight} />

      {world.projects.map((p) => (
        <DeckStack key={p.slug} project={p} center={at(pos, p.slug, ORIGIN)} nav={nav} palette={palette} />
      ))}

      {world.edges.map((e) => {
        const a = pos[e.from]; const b = pos[e.to];
        if (!a || !b) return null;
        const dir = Math.sign(b[0] - a[0]) || 1;
        const from: Vec3 = [a[0] + dir * PLINTH / 2, 0.22, a[2]];
        const to: Vec3 = [b[0] - dir * PLINTH / 2, 0.22, b[2]];
        const pts: Vec3[] = [from, to];
        const mid: Vec3 = [(from[0] + to[0]) / 2, 0.22, (from[2] + to[2]) / 2];
        const em = nav.state.focus.level === 0 ? 1 : 0.3;
        return (
          <group key={`${e.from}-${e.to}`}>
            <FlowLine points={pts} color={palette.accent} opacity={0.75 * em} width={2} dashSize={0.5} gapSize={0.3} speed={1} />
            <Pulse points={pts} color={palette.accent} size={0.12} period={2.6} />
            <WorldLabel position={mid} opacity={em} offset={[0, -16]}>
              <span className="mm3d-label mm3d-label-edge">{e.label}</span>
            </WorldLabel>
          </group>
        );
      })}
    </>
  );
}

function DeckStack({ project, center, nav, palette }: { project: WorldProject; center: Vec3; nav: WorldNav; palette: WorldPalette }) {
  const { t } = useTranslation();
  const { focus, hover } = nav.state;
  const mine = focus.project === project.slug;
  const exploded = focus.level >= 1 && mine;
  const em = nodeEmphasis(focus, project.slug, null);
  const id = nodeId(project.slug);
  const hovered = hover === id;
  useHoverCursor(hovered);
  const groups = useMemo(() => dimsByCategory(project), [project]);
  const gap = useRef(GAP_COLLAPSED);
  const decks = useRef<Array<THREE.Group | null>>([]);
  const stateColor = palette.state[project.state];

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
        <meshStandardMaterial color="#14161c" roughness={0.6} metalness={0.4} />
        <Edges color={hovered ? palette.primary : stateColor} lineWidth={1.2} />
      </mesh>
      {/* state light strip on the plinth's front edge */}
      <mesh position={[0, 0.17, PLINTH / 2 - 0.08]}>
        <boxGeometry args={[PLINTH - 0.4, 0.03, 0.08]} />
        <meshBasicMaterial color={stateColor} />
      </mesh>
      <Halo color={stateColor} size={PLINTH * 1.2} opacity={0.18 * em} position={[0, 0.3, 0]} />

      <WorldLabel position={[0, topY, 0]} opacity={em} interactive>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openProject(project.slug)}>
          <span className="mm3d-label mm3d-label-project">
            {project.name}
            <span className="mm3d-label-tag">{project.tag} · {project.state}</span>
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
            exploded={exploded}
            label={categoryLabel(t, g.category)}
          />
        </group>
      ))}
    </group>
  );
}

function Deck({ project, category, dims, nav, palette, exploded, label }: {
  project: WorldProject;
  category: DimCategory;
  dims: WorldDim[];
  nav: WorldNav;
  palette: WorldPalette;
  exploded: boolean;
  label: string;
}) {
  const { focus } = nav.state;
  const focusedHere = focus.level === 2 && focus.project === project.slug && dims.some((d) => d.key === focus.dim);
  const ghost = focus.level === 2 && focus.project === project.slug && !focusedHere;
  const deckOpacity = ghost ? 0.04 : exploded ? 0.16 : 0.1;
  const edgeColor = focusedHere ? palette.accent : palette.primary;
  return (
    <group>
      <mesh
        onClick={(e) => { e.stopPropagation(); nav.openProject(project.slug); }}
      >
        <boxGeometry args={[DECK, 0.06, DECK]} />
        <meshPhysicalMaterial color={palette.primary} transparent opacity={deckOpacity} roughness={0.15} metalness={0.1} transmission={0.2} depthWrite={false} />
        <Edges color={edgeColor} lineWidth={focusedHere ? 1.6 : 0.9} />
      </mesh>
      <WorldLabel position={[-DECK / 2 + 0.2, 0.05, DECK / 2 - 0.2]} opacity={exploded && !ghost ? 1 : 0} offset={[-10, -6]}>
        <span className="mm3d-label mm3d-label-dim mm3d-caps" style={{ '--w-dot': edgeColor, color: edgeColor } as React.CSSProperties}>{label}</span>
      </WorldLabel>
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
            exploded={exploded}
            emphasis={nodeEmphasis(focus, project.slug, d.key)}
            category={category}
          />
        );
      })}
    </group>
  );
}

function Tile({ project, dim, x, nav, palette, exploded, emphasis }: {
  project: WorldProject;
  dim: WorldDim;
  x: number;
  nav: WorldNav;
  palette: WorldPalette;
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
  const h = exploded ? 0.16 + dimProgress(dim) * 0.7 : 0.1;
  const mesh = useRef<THREE.Mesh>(null);
  const cur = useRef(0.1);
  const Icon = DIM_REGISTRY[dim.key].icon;

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
        onClick={(e) => { e.stopPropagation(); nav.openDim(project.slug, dim.key); }}
        onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }}
        onPointerOut={() => nav.hover(null)}
      >
        <boxGeometry args={[0.82, 1, 0.82]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim.status === 'absent' ? 0.05 : 0.3} roughness={0.5} metalness={0.1} transparent opacity={0.25 + emphasis * 0.75} />
        <Edges color={color} lineWidth={0.8} />
      </mesh>
      {pointed && <Halo color={palette.accent} size={3.2} opacity={0.6} position={[0, 0.6, 0]} />}
      {focused && <Halo color={color} size={2.6} opacity={0.5} position={[0, 0.7, 0]} />}
      <WorldLabel position={[0, 0.2 + h, 0]} opacity={exploded ? emphasis : 0} interactive={exploded} offset={[0, -14]}>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openDim(project.slug, dim.key)} style={{ '--w-dot': color } as React.CSSProperties}>
          <span className="mm3d-label mm3d-label-dim" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <Icon size={10} color={color} aria-hidden />
            {DIM_REGISTRY[dim.key].label}
          </span>
        </button>
      </WorldLabel>
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
