// Variant C — HOLO TABLE. A projection: each project is a hexagonal platform
// (the 2D canvas's own hex identity, carried into depth) with a central spire
// whose height is the automation score and fifteen hex prisms around it whose
// height is each dimension's progress and whose colour is its status. The
// four categories are sectors on the platform, labelled at their rim.
//
// Layer behaviour: L0 flattens the prisms into a tile (a bar chart seen from
// orbit); L1 raises them and labels them; L2 keeps one prism lit.
//
// Monochrome cyan on black, serif identity + mono numbers — continuity with the
// 2D canvas's cartographic voice.
import { Edges, OrbitControls, Sparkles } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import { DIM_REGISTRY } from '../lib/dimRegistry';
import { useTranslation } from '@/i18n/useTranslation';

import { dimProgress, dimsByCategory, type World, type WorldDim, type WorldProject } from './mockWorld';
import { HOLO, type WorldPalette } from './palettes';
import { at, CameraRig, damp, fitFactor, FlowLine, Halo, ORIGIN, pullBack, Pulse, useHoverCursor, WorldLabel, type CameraPose, type Vec3 } from './sceneBits';
import type { WorldNav } from './useWorldNav';
import { categoryLabel, effectiveDim } from './WorldHud';
import { nodeEmphasis, nodeId } from './worldModel';

const PLATFORM_R = 4.6;
const PRISM_RING_R = 2.75;
const PRISM_R = 0.42;
const PROJECT_GAP = 17;
const SLOT_START = -Math.PI / 2;

function projectPositions(world: World): Record<string, Vec3> {
  const n = world.projects.length;
  const out: Record<string, Vec3> = {};
  world.projects.forEach((p, i) => { out[p.slug] = [(i - (n - 1) / 2) * PROJECT_GAP, 0, 0]; });
  return out;
}

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

function cameraPose(nav: WorldNav, world: World, pos: Record<string, Vec3>): CameraPose {
  const { focus } = nav.state;
  if (focus.level === 0 || !focus.project) return { position: [0, 17, 21], target: [0, 0, 0] };
  const c = pos[focus.project] ?? [0, 0, 0];
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
  const pos = useMemo(() => projectPositions(world), [world]);
  const aspect = useThree((s) => s.viewport.aspect);
  const raw = cameraPose(nav, world, pos);
  const pose = nav.state.focus.level === 0 ? pullBack(raw, fitFactor(aspect)) : raw;
  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <fog attach="fog" args={[palette.fog ?? palette.bg, 30, 90]} />
      <ambientLight intensity={0.4} />
      <pointLight position={[0, 14, 4]} intensity={1.4} color={palette.primary} distance={60} />
      <directionalLight position={[-6, 10, -4]} intensity={0.35} />
      <Sparkles count={420} scale={[70, 18, 70]} size={1.6} speed={0.15} opacity={0.35} color={palette.primary} position={[0, 6, 0]} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={3} maxDistance={60} maxPolarAngle={Math.PI * 0.47} />
      <CameraRig pose={pose} flight={nav.state.flight} />

      {world.projects.map((p) => (
        <HexPlatform key={p.slug} project={p} center={at(pos, p.slug, ORIGIN)} nav={nav} palette={palette} />
      ))}

      {world.edges.map((e) => {
        const a = pos[e.from]; const b = pos[e.to];
        if (!a || !b) return null;
        const dir = Math.sign(b[0] - a[0]) || 1;
        const from: Vec3 = [a[0] + dir * PLATFORM_R, 0.06, a[2]];
        const to: Vec3 = [b[0] - dir * PLATFORM_R, 0.06, b[2]];
        const pts: Vec3[] = [];
        for (let i = 0; i <= 24; i++) {
          const t = i / 24;
          const s = Math.sin(t * Math.PI);
          pts.push([from[0] + (to[0] - from[0]) * t, 0.06, from[2] + (to[2] - from[2]) * t - s * 2.2]);
        }
        const mid = at(pts, 12, ORIGIN);
        const em = nav.state.focus.level === 0 ? 1 : 0.3;
        return (
          <group key={`${e.from}-${e.to}`}>
            <FlowLine points={pts} color={palette.primary} opacity={0.7 * em} width={1.8} dashSize={0.4} gapSize={0.3} speed={0.8} />
            <Pulse points={pts} color={palette.primary} size={0.12} period={3} />
            <WorldLabel position={mid} opacity={em} offset={[0, -14]}>
              <span className="mm3d-label mm3d-label-edge">{e.label}</span>
            </WorldLabel>
          </group>
        );
      })}
    </>
  );
}

/** Expanding radar ring on the floor — the table is "scanning". */
function ScanRing({ color, radius }: { color: string; radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = (clock.elapsedTime * 0.35) % 1;
    ref.current.scale.setScalar(0.4 + t * 1.2);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.35;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[radius - 0.05, radius, 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

function HexPlatform({ project, center, nav, palette }: { project: WorldProject; center: Vec3; nav: WorldNav; palette: WorldPalette }) {
  const { t } = useTranslation();
  const { focus, hover } = nav.state;
  const mine = focus.project === project.slug;
  const raised = focus.level >= 1 && mine;
  const em = nodeEmphasis(focus, project.slug, null);
  const id = nodeId(project.slug);
  const hovered = hover === id;
  useHoverCursor(hovered);
  const stateColor = palette.state[project.state];
  const slots = useMemo(() => prismSlots(project), [project]);
  const groups = useMemo(() => dimsByCategory(project), [project]);
  const spireH = 0.8 + (project.autoScore / 100) * 3;
  const spire = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    if (spire.current) spire.current.rotation.y = clock.elapsedTime * 0.5;
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
      <ScanRing color={palette.primary} radius={PLATFORM_R * 1.25} />
      {/* platform */}
      <mesh
        position={[0, 0.15, 0]}
        onClick={(e) => { e.stopPropagation(); nav.openProject(project.slug); }}
        onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }}
        onPointerOut={() => nav.hover(null)}
      >
        <cylinderGeometry args={[PLATFORM_R, PLATFORM_R + 0.25, 0.3, 6]} />
        <meshStandardMaterial color="#06131a" roughness={0.4} metalness={0.5} transparent opacity={0.92} />
        <Edges color={hovered ? palette.accent : palette.primary} lineWidth={1.3} />
      </mesh>
      {/* sector arcs */}
      {sectors.map((s) => (
        <group key={s.category}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.31, 0]}>
            {/* ringGeometry angles run counter-clockwise from +x; flip for the -z front. */}
            <ringGeometry args={[PRISM_RING_R + 0.85, PRISM_RING_R + 0.95, 48, 1, -s.start - s.length + 0.03, s.length - 0.06]} />
            <meshBasicMaterial color={palette.primary} transparent opacity={raised ? 0.55 : 0.18} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <WorldLabel position={[Math.cos(s.mid) * (PRISM_RING_R + 1.35), 0.32, Math.sin(s.mid) * (PRISM_RING_R + 1.35)]} opacity={raised ? 0.9 : 0}>
            <span className="mm3d-label mm3d-label-dim mm3d-caps" style={{ color: palette.primary, borderColor: 'transparent', background: 'transparent' }}>{categoryLabel(t, s.category)}</span>
          </WorldLabel>
        </group>
      ))}
      {/* spire = automation score */}
      <group ref={spire}>
        <mesh position={[0, 0.3 + spireH / 2, 0]}>
          <cylinderGeometry args={[0.22, 0.34, spireH, 6]} />
          <meshStandardMaterial color={stateColor} emissive={stateColor} emissiveIntensity={0.7} roughness={0.3} metalness={0.3} transparent opacity={0.4 + em * 0.6} />
          <Edges color={stateColor} lineWidth={0.8} />
        </mesh>
      </group>
      <Halo color={stateColor} size={2.6} opacity={0.7 * em} position={[0, 0.4 + spireH, 0]} />
      <Halo color={palette.primary} size={PLATFORM_R * 2.4} opacity={0.12 * em} position={[0, 0.5, 0]} />
      {project.fleet.some((f) => f.state === 'awaiting_input' || f.state === 'stale') && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.32, 0]}>
          <ringGeometry args={[PLATFORM_R - 0.35, PLATFORM_R - 0.28, 6]} />
          <meshBasicMaterial color={palette.accent} transparent opacity={0.85 * em} side={THREE.DoubleSide} />
        </mesh>
      )}

      <WorldLabel position={[0, 0.4, PLATFORM_R + 0.9]} opacity={em} interactive>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openProject(project.slug)}>
          <span className="mm3d-label mm3d-label-project">
            {project.name}
            <span className="mm3d-label-tag">{project.tag} · {project.state}</span>
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
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim.status === 'absent' ? 0.08 : 0.4} roughness={0.4} metalness={0.2} transparent opacity={0.3 + emphasis * 0.7} />
        <Edges color={color} lineWidth={0.7} />
      </mesh>
      {pointed && <Halo color={palette.accent} size={3} opacity={0.65} position={[0, 0.8, 0]} />}
      {focused && <Halo color={color} size={2.4} opacity={0.5} position={[0, target, 0]} />}
      <WorldLabel position={[0, target + 0.15, 0]} opacity={raised ? emphasis : 0} interactive={raised} offset={[0, -12]}>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openDim(project.slug, dim.key)} style={{ '--w-dot': color } as React.CSSProperties}>
          <span className="mm3d-label mm3d-label-dim" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <Icon size={10} color={color} aria-hidden />
            {DIM_REGISTRY[dim.key].label}
          </span>
        </button>
      </WorldLabel>
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
