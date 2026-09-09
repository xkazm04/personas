// Variant B — HOLO TABLE. A projection: each project is a hexagonal platform
// (the 2D canvas's own hex identity, carried into depth) with a central spire
// whose height is the automation score and fifteen hex prisms around it whose
// height is each dimension's progress and whose colour is its status. The four
// categories are sectors on the platform, labelled at their rim.
//
// ROUND 2 — ten projects instead of two, frosted instead of neon. Same three
// changes as Strata (see that file's header): a grid layout with a camera
// derived from its bounds, rough barely-emissive surfaces lit by the scene
// rather than glowing on their own, and per-dimension labels that mount only
// on the raised project.
//
// Ice on slate, serif identity + mono numbers — continuity with the 2D
// canvas's cartographic voice.
import { Edges, Environment, Lightformer, OrbitControls, Sparkles } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import { useTranslation } from '@/i18n/useTranslation';

import { DIM_REGISTRY } from '../lib/dimRegistry';

import { attentionDims, dimProgress, dimsByCategory, type World, type WorldDim, type WorldEdge, type WorldProject } from './mockWorld';
import { HOLO, type WorldPalette } from './palettes';
import { at, CameraRig, damp, FlowLine, Halo, ORIGIN, Pulse, useHoverCursor, WorldLabel, type CameraPose, type Vec3 } from './sceneBits';
import type { WorldNav } from './useWorldNav';
import { categoryLabel, effectiveDim } from './WorldHud';
import { fitPortfolio, gridPositions, isDensePortfolio, worldBounds } from './worldLayout';
import { nodeEmphasis, nodeId } from './worldModel';

const PLATFORM_R = 4.6;
const PRISM_RING_R = 2.75;
const PRISM_R = 0.42;
/** Centre-to-centre on the portfolio grid: a platform is 9.2 across. */
const PROJECT_GAP = 12.6;
const SLOT_START = -Math.PI / 2;

/** Slot angle for the i-th of `total` prisms around the ring. */
const slotAngle = (i: number, total: number): number => SLOT_START + (i / total) * Math.PI * 2;

/** Prism positions for a project: sequential slots, categories contiguous. */
function prismSlots(project: WorldProject): Array<{ dim: WorldDim; angle: number; catIndex: number }> {
  const groups = dimsByCategory(project);
  const total = groups.reduce((n, g) => n + g.dims.length, 0);
  const out: Array<{ dim: WorldDim; angle: number; catIndex: number }> = [];
  let i = 0;
  groups.forEach((g, ci) => {
    for (const dim of g.dims) { out.push({ dim, angle: slotAngle(i, total), catIndex: ci }); i++; }
  });
  return out;
}

const prismHeight = (dim: WorldDim, raised: boolean): number => (raised ? 0.3 + dimProgress(dim) * 1.7 : 0.16);

function cameraPose(nav: WorldNav, world: World, pos: Record<string, Vec3>, fov: number, aspect: number): CameraPose {
  const { focus } = nav.state;
  if (focus.level === 0 || !focus.project) {
    const bounds = worldBounds(world.projects.map((p) => at(pos, p.slug, ORIGIN)), PLATFORM_R * 1.05);
    const fit = fitPortfolio(bounds, { fov, aspect, pitch: 46, contentHeight: 3.4, margin: 1.08 });
    return { position: fit.position, target: fit.target };
  }
  const c = at(pos, focus.project, ORIGIN);
  if (focus.level === 1 || !focus.dim) return { position: [c[0], 9.5, c[2] + 11.5], target: [c[0], 0.6, c[2]] };
  const p = world.projects.find((x) => x.slug === focus.project);
  const slot = p ? prismSlots(p).find((s) => s.dim.key === focus.dim) : undefined;
  if (!slot) return { position: [c[0], 9.5, c[2] + 11.5], target: [c[0], 0.6, c[2]] };
  const px = c[0] + Math.cos(slot.angle) * PRISM_RING_R;
  const pz = c[2] + Math.sin(slot.angle) * PRISM_RING_R;
  const top = 0.3 + prismHeight(slot.dim, true);
  const ox = Math.cos(slot.angle) * 8;
  const oz = Math.sin(slot.angle) * 8;
  return { position: [px + ox, top + 5.5, pz + oz + 3], target: [px, top * 0.5, pz] };
}

export function HoloWorld({ world, nav }: { world: World; nav: WorldNav }) {
  const palette = HOLO;
  const pos = useMemo(() => gridPositions(world.projects.map((p) => p.slug), PROJECT_GAP), [world]);
  const aspect = useThree((s) => s.viewport.aspect);
  const fov = useThree((s) => (s.camera as THREE.PerspectiveCamera).fov ?? 42);
  const pose = cameraPose(nav, world, pos, fov, aspect);
  const dense = isDensePortfolio(world.projects.length);
  const span = useMemo(() => worldBounds(world.projects.map((p) => at(pos, p.slug, ORIGIN)), PLATFORM_R).radius, [world, pos]);

  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.fog ?? palette.bg, span * 1.3, span * 4]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 20, 8]} intensity={0.85} color="#e6f4f7" />
      <directionalLight position={[-14, 8, -10]} intensity={0.32} color="#8fb2bd" />
      <Environment resolution={64} frames={1}>
        <Lightformer form="ring" intensity={1.2} color="#dff2f7" position={[0, 14, 0]} scale={[16, 16, 1]} rotation={[-Math.PI / 2, 0, 0]} />
        <Lightformer form="rect" intensity={0.5} color="#9fc4cc" position={[10, 5, 12]} scale={[10, 6, 1]} />
      </Environment>
      <Sparkles count={Math.min(700, 60 * world.projects.length)} scale={[span * 2.4, 14, span * 2.4]} size={1.3} speed={0.12} opacity={0.22} color={palette.primary} position={[0, 5, 0]} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={span * 6} maxPolarAngle={Math.PI * 0.47} />
      <CameraRig pose={pose} flight={nav.state.flight} />

      {world.projects.map((p) => (
        <HexPlatform key={p.slug} project={p} center={at(pos, p.slug, ORIGIN)} nav={nav} palette={palette} dense={dense} />
      ))}

      {world.edges.map((e) => (
        <Trace key={`${e.from}-${e.to}`} edge={e} pos={pos} nav={nav} palette={palette} />
      ))}
    </>
  );
}

/** Floor trace between two platforms, bowed sideways so parallel edges on the
 *  grid stay tellable apart. Labelled only when one end is hovered or open. */
function Trace({ edge, pos, nav, palette }: { edge: WorldEdge; pos: Record<string, Vec3>; nav: WorldNav; palette: WorldPalette }) {
  const a = pos[edge.from]; const b = pos[edge.to];
  const { hover, focus } = nav.state;
  const pts = useMemo<Vec3[]>(() => {
    if (!a || !b) return [];
    const dx = b[0] - a[0]; const dz = b[2] - a[2];
    const len = Math.hypot(dx, dz) || 1;
    const ux = dx / len; const uz = dz / len;
    const inset = PLATFORM_R + 0.2;
    const fx = a[0] + ux * inset, fz = a[2] + uz * inset;
    const tx = b[0] - ux * inset, tz = b[2] - uz * inset;
    const bow = Math.min(2.4, len * 0.16);
    const out: Vec3[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const s = Math.sin(t * Math.PI) * bow;
      out.push([fx + (tx - fx) * t - uz * s, 0.06, fz + (tz - fz) * t + ux * s]);
    }
    return out;
  }, [a, b]);
  if (pts.length === 0) return null;
  const mid = at(pts, 12, ORIGIN);
  const touched = hover === edge.from || hover === edge.to || focus.project === edge.from || focus.project === edge.to;
  const em = focus.level === 0 ? 1 : touched ? 0.9 : 0.2;
  const color = edge.kind === 'similarity' ? palette.textDim : palette.primary;
  return (
    <group>
      <FlowLine
        points={pts}
        color={color}
        opacity={(edge.kind === 'similarity' ? 0.3 : 0.55) * em}
        width={edge.kind === 'similarity' ? 1 : 1.6}
        dashSize={edge.kind === 'similarity' ? 0.2 : 0.4}
        gapSize={0.3}
        speed={edge.kind === 'similarity' ? 0.25 : 0.8}
      />
      {edge.kind === 'relation' && <Pulse points={pts} color={color} size={0.09} period={3.2} />}
      {touched && (
        <WorldLabel position={mid} opacity={1} offset={[0, -14]}>
          <span className="mm3d-label mm3d-label-edge">{edge.label}</span>
        </WorldLabel>
      )}
    </group>
  );
}

/** Expanding radar ring on the floor — the table is "scanning". */
function ScanRing({ color, radius, opacity }: { color: string; radius: number; opacity: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime * 0.3) % 1;
    ref.current.scale.setScalar(0.4 + t * 1.2);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * opacity;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[radius - 0.05, radius, 6]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function HexPlatform({ project, center, nav, palette, dense }: { project: WorldProject; center: Vec3; nav: WorldNav; palette: WorldPalette; dense: boolean }) {
  const { t } = useTranslation();
  const { focus, hover } = nav.state;
  const mine = focus.project === project.slug;
  const raised = focus.level >= 1 && mine;
  const em = nodeEmphasis(focus, project.slug, null);
  const id = nodeId(project.slug);
  const hovered = hover === id;
  useHoverCursor(hovered);
  const stateColor = palette.state[project.state];
  const f = palette.frost;
  const slots = useMemo(() => prismSlots(project), [project]);
  const groups = useMemo(() => dimsByCategory(project), [project]);
  const attention = useMemo(() => attentionDims(project).length, [project]);
  const spireH = 0.8 + (project.autoScore / 100) * 3;
  const spire = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (spire.current) spire.current.rotation.y = clock.elapsedTime * 0.35;
  });

  // Category sectors — contiguous slot ranges → ring arcs on the platform.
  let cursor = 0;
  const total = slots.length;
  const sectors = groups.map((g, ci) => {
    const start = slotAngle(cursor, total) - Math.PI / total;
    const length = (g.dims.length / total) * Math.PI * 2;
    cursor += g.dims.length;
    return { category: g.category, start, length, ci, mid: start + length / 2 };
  });

  return (
    <group position={center}>
      <ScanRing color={palette.primary} radius={PLATFORM_R * 1.22} opacity={0.16 * em} />
      {/* platform */}
      <mesh
        position={[0, 0.15, 0]}
        onClick={(e) => { e.stopPropagation(); nav.openProject(project.slug); }}
        onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }}
        onPointerOut={() => nav.hover(null)}
      >
        <cylinderGeometry args={[PLATFORM_R, PLATFORM_R + 0.25, 0.3, 6]} />
        <meshPhysicalMaterial color={palette.structure} roughness={0.85} metalness={0.1} clearcoat={0.2} clearcoatRoughness={0.75} />
        <Edges color={hovered ? palette.accent : palette.primary} lineWidth={hovered ? 1.4 : 1} />
      </mesh>
      {/* sector arcs */}
      {sectors.map((s) => (
        <group key={s.category}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.31, 0]}>
            {/* ringGeometry angles run counter-clockwise from +x; flip for the -z front. */}
            <ringGeometry args={[PRISM_RING_R + 0.85, PRISM_RING_R + 0.95, 48, 1, -s.start - s.length + 0.03, s.length - 0.06]} />
            <meshBasicMaterial color={palette.primary} transparent opacity={raised ? 0.45 : 0.14} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {raised && (
            <WorldLabel position={[Math.cos(s.mid) * (PRISM_RING_R + 1.35), 0.32, Math.sin(s.mid) * (PRISM_RING_R + 1.35)]} opacity={0.9}>
              <span className="mm3d-label mm3d-label-dim mm3d-caps" style={{ color: palette.primary, borderColor: 'transparent', background: 'transparent' }}>{categoryLabel(t, s.category)}</span>
            </WorldLabel>
          )}
        </group>
      ))}
      {/* spire = automation score */}
      <group ref={spire}>
        <mesh position={[0, 0.3 + spireH / 2, 0]}>
          <cylinderGeometry args={[0.22, 0.34, spireH, 6]} />
          <meshPhysicalMaterial
            color={stateColor}
            emissive={stateColor}
            emissiveIntensity={f.emissive * 1.6}
            roughness={f.roughness}
            metalness={f.metalness}
            clearcoat={f.clearcoat}
            clearcoatRoughness={f.clearcoatRoughness}
            transparent
            opacity={0.55 + em * 0.45}
          />
          <Edges color={stateColor} lineWidth={0.7} />
        </mesh>
      </group>
      <Halo color={stateColor} size={2.2} opacity={f.halo * 1.6 * em} position={[0, 0.4 + spireH, 0]} />
      <Halo color={palette.primary} size={PLATFORM_R * 2} opacity={f.halo * 0.5 * em} position={[0, 0.5, 0]} />
      {project.fleet.some((x) => x.state === 'awaiting_input' || x.state === 'stale') && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.32, 0]}>
          <ringGeometry args={[PLATFORM_R - 0.35, PLATFORM_R - 0.28, 6]} />
          <meshBasicMaterial color={palette.accent} transparent opacity={0.7 * em} side={THREE.DoubleSide} />
        </mesh>
      )}

      <WorldLabel position={[0, 0.4, PLATFORM_R + 0.9]} opacity={em} interactive>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openProject(project.slug)}>
          <span className={`mm3d-label mm3d-label-project${dense && !mine ? ' mm3d-label-project--dense' : ''}`}>
            {project.name}
            <span className="mm3d-label-tag">
              {project.tag} · {project.state}
              {attention > 0 && <b className="mm3d-label-attn" style={{ color: palette.status.risk }}> · {attention}</b>}
            </span>
          </span>
        </button>
      </WorldLabel>

      {slots.map(({ dim: raw, angle }) => {
        const dim = effectiveDim(nav, project.slug, raw);
        return (
          <Prism
            key={dim.key}
            project={project}
            dim={dim}
            position={[Math.cos(angle) * PRISM_RING_R, 0.3, Math.sin(angle) * PRISM_RING_R]}
            nav={nav}
            palette={palette}
            raised={raised}
            emphasis={nodeEmphasis(focus, project.slug, dim.key)}
          />
        );
      })}
    </group>
  );
}

function Prism({ project, dim, position, nav, palette, raised, emphasis }: {
  project: WorldProject;
  dim: WorldDim;
  position: Vec3;
  nav: WorldNav;
  palette: WorldPalette;
  raised: boolean;
  emphasis: number;
}) {
  const id = nodeId(project.slug, dim.key);
  const hovered = nav.state.hover === id;
  const focused = nav.state.focus.dim === dim.key && nav.state.focus.project === project.slug;
  const pointed = nav.state.highlight.has(id);
  useHoverCursor(hovered);
  const color = palette.status[dim.status];
  const f = palette.frost;
  const target = prismHeight(dim, raised) * (focused ? 1.25 : hovered ? 1.1 : 1);
  const mesh = useRef<THREE.Mesh>(null);
  const cur = useRef(0.16);
  const Icon = DIM_REGISTRY[dim.key].icon;

  useFrame((_, dt) => {
    if (!mesh.current) return;
    cur.current = damp(cur.current, target, 6, dt);
    mesh.current.scale.y = cur.current;
    mesh.current.position.y = cur.current / 2;
  });

  return (
    <group position={position}>
      <mesh
        ref={mesh}
        onClick={(e) => { e.stopPropagation(); nav.openDim(project.slug, dim.key); }}
        onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }}
        onPointerOut={() => nav.hover(null)}
      >
        <cylinderGeometry args={[PRISM_R, PRISM_R, 1, 6]} />
        <meshPhysicalMaterial
          color={color}
          emissive={color}
          emissiveIntensity={dim.status === 'absent' ? f.emissiveMuted : f.emissive}
          roughness={f.roughness}
          metalness={f.metalness}
          clearcoat={f.clearcoat}
          clearcoatRoughness={f.clearcoatRoughness}
          transparent
          opacity={0.45 + emphasis * 0.55}
        />
        <Edges color={color} lineWidth={0.6} />
      </mesh>
      {pointed && <Halo color={palette.accent} size={2.4} opacity={f.halo * 2.4} position={[0, 0.8, 0]} />}
      {focused && <Halo color={color} size={2} opacity={f.halo * 1.8} position={[0, target, 0]} />}
      {raised && (
        <WorldLabel position={[0, target + 0.15, 0]} opacity={emphasis} interactive offset={[0, -12]}>
          <button type="button" className="mm3d-label-btn" onClick={() => nav.openDim(project.slug, dim.key)} style={{ '--w-dot': color } as React.CSSProperties}>
            <span className="mm3d-label mm3d-label-dim" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
              <Icon size={10} color={color} aria-hidden />
              {DIM_REGISTRY[dim.key].label}
            </span>
          </button>
        </WorldLabel>
      )}
      {focused && (
        <WorldLabel position={[0, target * 0.6, 0]} opacity={1} offset={[110, 0]}>
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
