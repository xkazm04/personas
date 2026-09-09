// Variant A — ORBIT. A constellation: each project is a glowing core with its
// fifteen dimensions as satellites on four category rings. This is the world
// closest to the reference build's "knowledge galaxy" — deep space, cold cyan,
// and Athena flies the camera to the exact node she is talking about.
//
// Layer behaviour: L0 shows cores + faint rings (satellites are small, dim,
// unlabeled); L1 brings one project's rings up to full brightness, labels the
// satellites and spokes them to the core; L2 flies to a single satellite and
// leaves the rest of the ring as ghosts.
import { OrbitControls, Stars } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';

import { DIM_REGISTRY } from '../lib/dimRegistry';

import { dimProgress, dimsByCategory, type World, type WorldDim, type WorldProject } from './mockWorld';
import { ORBIT, type WorldPalette } from './palettes';
import { arcPoints, at, CameraRig, damp, fitFactor, FlowLine, Halo, ORIGIN, pullBack, Pulse, useHoverCursor, WorldLabel, type CameraPose, type Vec3 } from './sceneBits';
import type { WorldNav } from './useWorldNav';
import { effectiveDim } from './WorldHud';
import { nodeEmphasis, nodeId } from './worldModel';

const CORE_R = 1.5;
/** Ring radius per category index, and the tilt that keeps the four rings
 *  from overlapping when read from the default 3/4 camera. */
const RING_R = [3.1, 4.1, 5.1, 6.1];
const RING_TILT = [0.18, -0.22, 0.3, -0.12];
const PROJECT_GAP = 16;

/** Project centres — a row for two, a spiral would take over past four. */
function projectPositions(world: World): Record<string, Vec3> {
  const n = world.projects.length;
  const out: Record<string, Vec3> = {};
  world.projects.forEach((p, i) => { out[p.slug] = [(i - (n - 1) / 2) * PROJECT_GAP, 0, 0]; });
  return out;
}

/** Drift speed per ring (rad/s) — rings turn only at L0; a focused project's
 *  satellites hold still so their labels can be read. */
const RING_SPEED = [0.05, -0.04, 0.035, -0.03];

/** Satellite position in its ring's LOCAL frame (flat circle, y = 0). The ring
 *  group carries the tilt and the drift rotation, so satellites and their DOM
 *  labels move without a single React re-render. */
function satelliteLocal(catIndex: number, i: number, count: number): Vec3 {
  const r = RING_R[catIndex] ?? 6;
  const a = (i / count) * Math.PI * 2 + catIndex * 0.7;
  return [Math.cos(a) * r, 0, Math.sin(a) * r];
}

/** World position of a satellite given the ring's current drift angle. */
function satelliteWorld(center: Vec3, catIndex: number, i: number, count: number, drift: number): Vec3 {
  const local = satelliteLocal(catIndex, i, count);
  const tilt = RING_TILT[catIndex] ?? 0;
  // The ring group is rotation=[tilt, drift, 0] in three's default XYZ order,
  // which applies the Y drift to the vector first and the X tilt second —
  // exactly Euler(tilt, drift, 0, 'XYZ') here.
  const e = new THREE.Euler(tilt, drift, 0, 'XYZ');
  const v = new THREE.Vector3(...local).applyEuler(e);
  return [center[0] + v.x, center[1] + v.y, center[2] + v.z];
}

function cameraPose(nav: WorldNav, pos: Record<string, Vec3>, satPos: (slug: string, key: string) => Vec3 | null): CameraPose {
  const { focus } = nav.state;
  if (focus.level === 0 || !focus.project) return { position: [0, 11, 22], target: [0, 0, 0] };
  const c = pos[focus.project] ?? [0, 0, 0];
  if (focus.level === 1 || !focus.dim) return { position: [c[0], c[1] + 6.5, c[2] + 12.5], target: c };
  const s = satPos(focus.project, focus.dim) ?? c;
  // Stand OUTSIDE the ring looking back past the satellite, offset sideways
  // so the core sits beside the frame instead of filling it.
  const dir = new THREE.Vector3(s[0] - c[0], 0, s[2] - c[2]).normalize();
  const side = new THREE.Vector3(-dir.z, 0, dir.x);
  return { position: [s[0] + dir.x * 8 + side.x * 7, s[1] + 5, s[2] + dir.z * 8 + side.z * 7], target: [s[0] - dir.x * 0.5, s[1] + 0.2, s[2] - dir.z * 0.5] };
}

export function OrbitWorld({ world, nav }: { world: World; nav: WorldNav }) {
  const palette = ORBIT;
  const pos = useMemo(() => projectPositions(world), [world]);
  // Current drift angle per project ring — written by the ring groups each
  // frame, read once when a flight to a satellite is planned.
  const drift = useRef<Record<string, number[]>>({});
  const satPos = (slug: string, key: string): Vec3 | null => {
    const p = world.projects.find((x) => x.slug === slug);
    if (!p) return null;
    const groups = dimsByCategory(p);
    for (let ci = 0; ci < groups.length; ci++) {
      const dims = groups[ci]?.dims ?? [];
      const idx = dims.findIndex((d) => d.key === key);
      if (idx >= 0) return satelliteWorld(at(pos, slug, ORIGIN), ci, idx, dims.length, drift.current[slug]?.[ci] ?? 0);
    }
    return null;
  };
  const aspect = useThree((s) => s.viewport.aspect);
  const raw = cameraPose(nav, pos, satPos);
  const pose = nav.state.focus.level === 0 ? pullBack(raw, fitFactor(aspect)) : raw;

  return (
    <>
      <color attach="background" args={[palette.bg]} />
      <ambientLight intensity={0.35} />
      <pointLight position={[0, 20, 10]} intensity={1.2} color={palette.primary} />
      <Stars radius={160} depth={60} count={2600} factor={3} saturation={0.2} fade speed={0.4} />
      <Nebula palette={palette} />
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} minDistance={2.5} maxDistance={60} maxPolarAngle={Math.PI * 0.62} />
      <CameraRig pose={pose} flight={nav.state.flight} />

      {world.projects.map((p) => (
        <ProjectCore key={p.slug} project={p} center={at(pos, p.slug, ORIGIN)} nav={nav} palette={palette} drift={drift} />
      ))}

      {world.edges.map((e) => {
        const a = pos[e.from]; const b = pos[e.to];
        if (!a || !b) return null;
        const pts = arcPoints([a[0], a[1] + 0.4, a[2]], [b[0], b[1] + 0.4, b[2]], 4.5);
        const mid = at(pts, Math.floor(pts.length / 2), ORIGIN);
        const em = nav.state.focus.level === 0 ? 1 : 0.35;
        return (
          <group key={`${e.from}-${e.to}`}>
            <FlowLine points={pts} color={palette.primary} opacity={0.55 * em} width={1.6} />
            <Pulse points={pts} color={palette.primary} size={0.14} period={3.2} />
            <WorldLabel position={mid} opacity={em} offset={[0, -14]}>
              <span className="mm3d-label mm3d-label-edge">{e.label}</span>
            </WorldLabel>
          </group>
        );
      })}
    </>
  );
}

/** Two soft nebula sprites — colour depth behind the constellation. */
function Nebula({ palette }: { palette: WorldPalette }) {
  return (
    <group>
      <Halo color={palette.primary} size={70} opacity={0.08} position={[-12, -6, -30]} />
      <Halo color={palette.accent} size={50} opacity={0.05} position={[18, 8, -40]} />
    </group>
  );
}

function ProjectCore({ project, center, nav, palette, drift }: { project: WorldProject; center: Vec3; nav: WorldNav; palette: WorldPalette; drift: React.RefObject<Record<string, number[]>> }) {
  const { focus, hover, highlight } = nav.state;
  const em = nodeEmphasis(focus, project.slug, null);
  const color = palette.state[project.state];
  const id = nodeId(project.slug);
  const hovered = hover === id;
  useHoverCursor(hovered);
  const ring = useRef<THREE.Group>(null);
  const coreScale = useRef(1);
  const core = useRef<THREE.Mesh>(null);
  const groups = useMemo(() => dimsByCategory(project), [project]);
  const rings = useRef<Array<THREE.Group | null>>([]);
  const mine = focus.project === project.slug;
  const drifting = focus.level === 0;

  useFrame(({ clock }, dt) => {
    if (ring.current) ring.current.rotation.y = clock.elapsedTime * 0.12;
    const target = hovered ? 1.15 : 1;
    coreScale.current = damp(coreScale.current, target, 8, dt);
    core.current?.scale.setScalar(coreScale.current);
    // Rings drift imperatively — no React work per frame. They hold still
    // once a project is focused so the labels stay put under the cursor.
    if (drifting) {
      const angles = (drift.current[project.slug] ??= []);
      rings.current.forEach((g, ci) => {
        if (!g) return;
        g.rotation.y += dt * (RING_SPEED[ci] ?? 0.03);
        angles[ci] = g.rotation.y;
      });
    }
  });

  const showLabels = focus.level >= 1 && mine;
  const lit = focus.level === 0 || mine;

  return (
    <group position={center}>
      {/* core */}
      <mesh
        ref={core}
        onClick={(e) => { e.stopPropagation(); nav.openProject(project.slug); }}
        onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }}
        onPointerOut={() => nav.hover(null)}
      >
        <sphereGeometry args={[CORE_R, 48, 48]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={lit ? 0.9 : 0.25} roughness={0.35} metalness={0.2} transparent opacity={Math.max(0.35, em)} />
      </mesh>
      <Halo color={color} size={CORE_R * 6} opacity={0.55 * em} />
      <Halo color={palette.primary} size={CORE_R * 2.6} opacity={0.35 * em} />
      {/* tilted identity rings around the core */}
      <group ref={ring}>
        <mesh rotation={[Math.PI / 2 + 0.35, 0, 0]}>
          <torusGeometry args={[CORE_R * 1.45, 0.02, 8, 96]} />
          <meshBasicMaterial color={palette.primary} transparent opacity={0.7 * em} />
        </mesh>
        <mesh rotation={[Math.PI / 2 - 0.5, 0.4, 0]}>
          <torusGeometry args={[CORE_R * 1.75, 0.012, 8, 96]} />
          <meshBasicMaterial color={palette.primary} transparent opacity={0.4 * em} />
        </mesh>
      </group>
      {/* attention marker — a warm ring when a session needs you */}
      {project.fleet.some((f) => f.state === 'awaiting_input' || f.state === 'stale') && (
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
          <ringGeometry args={[CORE_R * 2.05, CORE_R * 2.15, 64]} />
          <meshBasicMaterial color={palette.accent} transparent opacity={0.8 * em} side={THREE.DoubleSide} />
        </mesh>
      )}
      <WorldLabel position={[0, -CORE_R - 1.1, 0]} opacity={em} interactive>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openProject(project.slug)}>
          <span className="mm3d-label mm3d-label-project">
            {project.name}
            <span className="mm3d-label-tag">{project.tag} · {project.state}</span>
          </span>
        </button>
      </WorldLabel>

      {/* category rings + satellites */}
      {groups.map((g, ci) => (
        // The ring group owns the tilt (x) and the drift (y, imperative).
        <group key={g.category} ref={(el) => { rings.current[ci] = el; }} rotation={[RING_TILT[ci] ?? 0, 0, 0]}>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[at(RING_R, ci, 6) - 0.012, at(RING_R, ci, 6) + 0.012, 128]} />
            <meshBasicMaterial color={palette.primary} transparent opacity={(lit ? 0.28 : 0.06) * (focus.level === 0 ? 0.7 : 1)} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          {g.dims.map((raw, i) => {
            const d = effectiveDim(nav, project.slug, raw);
            const p = satelliteLocal(ci, i, g.dims.length);
            return (
              <Satellite
                key={d.key}
                project={project}
                dim={d}
                position={p}
                nav={nav}
                palette={palette}
                emphasis={nodeEmphasis(focus, project.slug, d.key)}
                showLabel={showLabels}
                pointed={highlight.has(nodeId(project.slug, d.key))}
              />
            );
          })}
        </group>
      ))}
    </group>
  );
}

function Satellite({ project, dim, position, nav, palette, emphasis, showLabel, pointed }: {
  project: WorldProject;
  dim: WorldDim;
  position: Vec3;
  nav: WorldNav;
  palette: WorldPalette;
  emphasis: number;
  showLabel: boolean;
  pointed: boolean;
}) {
  const id = nodeId(project.slug, dim.key);
  const hovered = nav.state.hover === id;
  const focused = nav.state.focus.dim === dim.key && nav.state.focus.project === project.slug;
  useHoverCursor(hovered);
  const color = palette.status[dim.status];
  const ref = useRef<THREE.Group>(null);
  const scale = useRef(1);
  const size = 0.22 + dimProgress(dim) * 0.16;
  const Icon = DIM_REGISTRY[dim.key].icon;

  useFrame(({ clock }, dt) => {
    if (!ref.current) return;
    const target = (focused ? 1.25 : hovered ? 1.3 : 1) * (0.6 + emphasis * 0.4);
    scale.current = damp(scale.current, target, 8, dt);
    ref.current.scale.setScalar(scale.current);
    ref.current.rotation.y = clock.elapsedTime * 0.8;
    ref.current.rotation.x = clock.elapsedTime * 0.35;
  });

  const spokeOpacity = showLabel ? 0.18 * emphasis : 0;
  const labelOpacity = showLabel ? emphasis : 0;

  return (
    <group position={position}>
      {spokeOpacity > 0 && (
        <FlowLine points={[[0, 0, 0], [-position[0], -position[1], -position[2]]]} color={color} opacity={spokeOpacity} width={0.8} speed={0.25} dashSize={0.18} gapSize={0.32} />
      )}
      <group ref={ref}>
        <mesh
          onClick={(e) => { e.stopPropagation(); nav.openDim(project.slug, dim.key); }}
          onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }}
          onPointerOut={() => nav.hover(null)}
        >
          <octahedronGeometry args={[size, 0]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dim.status === 'absent' ? 0.1 : 0.55} roughness={0.3} transparent opacity={0.3 + emphasis * 0.7} />
        </mesh>
        {/* pick-up padding — the octahedron is small at L0 */}
        <mesh visible={false} onClick={(e) => { e.stopPropagation(); nav.openDim(project.slug, dim.key); }} onPointerOver={(e) => { e.stopPropagation(); nav.hover(id); }} onPointerOut={() => nav.hover(null)}>
          <sphereGeometry args={[size * 2.4, 8, 8]} />
        </mesh>
      </group>
      <Halo color={color} size={size * (pointed ? 12 : focused ? 4 : 7)} opacity={(dim.status === 'absent' ? 0.15 : focused ? 0.35 : 0.6) * emphasis} />
      {pointed && <Halo color={palette.accent} size={size * 18} opacity={0.45} />}
      <WorldLabel position={[0, 0, 0]} opacity={labelOpacity} interactive={showLabel} offset={[0, 22]}>
        <button type="button" className="mm3d-label-btn" onClick={() => nav.openDim(project.slug, dim.key)} style={{ '--w-dot': color } as React.CSSProperties}>
          <span className="mm3d-label mm3d-label-dim" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem' }}>
            <Icon size={10} color={color} aria-hidden />
            {DIM_REGISTRY[dim.key].label}
          </span>
        </button>
      </WorldLabel>
      {focused && (
        <WorldLabel position={[0, 0, 0]} opacity={1} offset={[120, -10]}>
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
