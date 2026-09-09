// Shared three.js bits for the three worlds: a cheap additive glow (no
// post-processing bloom is installed — a radial sprite reads the same at this
// scale and costs nothing), a camera rig that FLIES between the layer poses,
// DOM labels anchored in world space, and an animated dashed connector.
import { Html, Line } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';

export type Vec3 = [number, number, number];

export const ORIGIN: Vec3 = [0, 0, 0];

/** Index into a position map / point list without the `| undefined` — a
 *  missing entry is a programming error in a fixed layout, not a runtime case. */
export const at = <T,>(xs: readonly T[] | Record<string, T>, k: number | string, fallback: T): T =>
  (Array.isArray(xs) ? xs[k as number] : (xs as Record<string, T>)[k as string]) ?? fallback;

/** Pull-back factor for the portfolio pose on a narrow canvas: poses are
 *  tuned for a ~1.8 aspect; below that the horizontal field shrinks and both
 *  projects no longer fit, so scale the camera offset up to compensate. */
export const fitFactor = (aspect: number): number => Math.min(2.6, Math.max(1, 1.8 / Math.max(0.2, aspect)));

/** Scale a pose's offset from its target by k (k = 1 leaves it alone). */
export function pullBack(pose: CameraPose, k: number): CameraPose {
  if (k === 1) return pose;
  const [px, py, pz] = pose.position; const [tx, ty, tz] = pose.target;
  return { position: [tx + (px - tx) * k, ty + (py - ty) * k, tz + (pz - tz) * k], target: pose.target };
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
}

export const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** Exponential damping toward a target — frame-rate independent. */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  THREE.MathUtils.damp(current, target, lambda, dt);

let glowTex: THREE.CanvasTexture | null = null;

/** Radial white-to-transparent disc, tinted by the sprite material colour. */
export function glowTexture(): THREE.CanvasTexture {
  if (glowTex) return glowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  glowTex = new THREE.CanvasTexture(canvas);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  return glowTex;
}

/** Additive billboard glow. `size` is world units of the sprite's edge. */
export function Halo({ color, size, opacity = 0.8, position }: { color: string; size: number; opacity?: number; position?: Vec3 }) {
  const map = useMemo(glowTexture, []);
  return (
    <sprite scale={[size, size, 1]} position={position}>
      <spriteMaterial map={map} color={color} transparent opacity={opacity} blending={THREE.AdditiveBlending} depthWrite={false} depthTest />
    </sprite>
  );
}

interface ControlsLike { target: THREE.Vector3; update: () => void }

/**
 * Flies the camera to `pose` whenever `flight` changes (the nav reducer bumps
 * it on every focus change). Between flights the user owns the camera through
 * OrbitControls — the rig never fights a drag, it only answers a click.
 */
export function CameraRig({ pose, flight, duration = 1100 }: { pose: CameraPose; flight: number; duration?: number }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as ControlsLike | null;
  const anim = useRef<{ from: THREE.Vector3; fromT: THREE.Vector3; to: THREE.Vector3; toT: THREE.Vector3; start: number } | null>(null);
  const first = useRef(true);

  useEffect(() => {
    const to = new THREE.Vector3(...pose.position);
    const toT = new THREE.Vector3(...pose.target);
    if (first.current) {
      first.current = false;
      camera.position.copy(to);
      if (controls) { controls.target.copy(toT); controls.update(); } else camera.lookAt(toT);
      return;
    }
    anim.current = {
      from: camera.position.clone(),
      fromT: controls ? controls.target.clone() : toT.clone(),
      to,
      toT,
      start: performance.now(),
    };
    // `pose` is derived from `flight`; listing it would restart the flight on
    // every unrelated re-render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flight, camera, controls]);

  useFrame(() => {
    const a = anim.current;
    if (!a) return;
    const t = Math.min(1, (performance.now() - a.start) / duration);
    const k = easeInOutCubic(t);
    camera.position.lerpVectors(a.from, a.to, k);
    const target = new THREE.Vector3().lerpVectors(a.fromT, a.toT, k);
    if (controls) { controls.target.copy(target); controls.update(); } else camera.lookAt(target);
    if (t >= 1) anim.current = null;
  });
  return null;
}

/**
 * A DOM label pinned to a world position. Screen-space (not `transform`), so
 * typography stays crisp at every distance — the thing these prototypes are
 * judging. `interactive` labels take pointer events (they are buttons).
 */
export function WorldLabel({ position, children, opacity = 1, interactive = false, className, offset = [0, 0] }: {
  position: Vec3;
  children: ReactNode;
  opacity?: number;
  interactive?: boolean;
  className?: string;
  /** Screen-pixel nudge [x, y]. */
  offset?: [number, number];
}) {
  return (
    <Html
      position={position}
      center
      zIndexRange={[30, 0]}
      style={{ pointerEvents: interactive ? 'auto' : 'none', opacity, transform: `translate(${offset[0]}px, ${offset[1]}px)`, transition: 'opacity 320ms ease' }}
      className={className}
    >
      {/* Labels are DOM siblings of the canvas inside R3F's event root; stop
          their clicks there so the world never sees them as a miss. */}
      <div onClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}>
        {children}
      </div>
    </Html>
  );
}

/** Dashed line whose dashes crawl from `from` toward `to` — a connector that
 *  reads as FLOW (integration direction), not as a fence. */
export function FlowLine({ points, color, opacity = 0.8, width = 1.4, speed = 0.6, dashSize = 0.35, gapSize = 0.25 }: {
  points: Vec3[];
  color: string;
  opacity?: number;
  width?: number;
  speed?: number;
  dashSize?: number;
  gapSize?: number;
}) {
  const ref = useRef<{ material: { dashOffset: number } } | null>(null);
  useFrame((_, dt) => {
    if (ref.current) ref.current.material.dashOffset -= dt * speed;
  });
  return (
    // drei's Line ref is a Line2 — only `material.dashOffset` is touched.
    <Line ref={ref as never} points={points} color={color} lineWidth={width} dashed dashSize={dashSize} gapSize={gapSize} transparent opacity={opacity} depthWrite={false} />
  );
}

/** Points along a raised arc between two world positions. */
export function arcPoints(a: Vec3, b: Vec3, lift: number, segments = 32): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[2] + (b[2] - a[2]) * t;
    const y = a[1] + (b[1] - a[1]) * t + Math.sin(t * Math.PI) * lift;
    out.push([x, y, z]);
  }
  return out;
}

/** A pulse of light travelling along `points` on a loop. */
export function Pulse({ points, color, size = 0.22, period = 2.4, phase = 0 }: { points: Vec3[]; color: string; size?: number; period?: number; phase?: number }) {
  const ref = useRef<THREE.Group>(null);
  const curve = useMemo(() => new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p))), [points]);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = ((clock.elapsedTime + phase) / period) % 1;
    ref.current.position.copy(curve.getPointAt(t));
  });
  return (
    <group ref={ref}>
      <Halo color={color} size={size * 5} opacity={0.9} />
      <mesh>
        <sphereGeometry args={[size, 12, 12]} />
        <meshBasicMaterial color="#ffffff" />
      </mesh>
    </group>
  );
}

/** Hover state → pointer cursor on the canvas. */
export function useHoverCursor(hovered: boolean) {
  useEffect(() => {
    if (!hovered) return;
    const prev = document.body.style.cursor;
    document.body.style.cursor = 'pointer';
    return () => { document.body.style.cursor = prev; };
  }, [hovered]);
}
