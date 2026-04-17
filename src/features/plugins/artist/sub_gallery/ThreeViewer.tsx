import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, Stage, Bounds } from '@react-three/drei';
import { convertFileSrc } from '@tauri-apps/api/core';
import { Box, Loader2 } from 'lucide-react';
import * as THREE from 'three';

type LightingPreset = 'studio' | 'outdoor' | 'soft';

interface ThreeViewerProps {
  filePath: string;
  wireframe: boolean;
  autoRotate: boolean;
  lightingPreset: LightingPreset;
}

// Map our 3 presets onto drei's `Environment` HDR presets. The names come
// from the built-in drei environment set, so no remote assets are fetched.
const ENV_PRESET: Record<LightingPreset, 'studio' | 'sunset' | 'apartment'> = {
  studio: 'studio',
  outdoor: 'sunset',
  soft: 'apartment',
};

/**
 * Walk a scene tree and apply a uniform material flag (wireframe) to every
 * mesh. `useGLTF` caches nodes across mounts, so we have to set this every
 * frame — otherwise toggling it back off wouldn't take effect on a cached
 * clone.
 */
function useWireframe(scene: THREE.Object3D, wireframe: boolean) {
  useEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.isMesh) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of materials) {
          const mat = m as THREE.Material & { wireframe?: boolean };
          if ('wireframe' in mat) mat.wireframe = wireframe;
        }
      }
    });
  }, [scene, wireframe]);
}

function ModelScene({
  url,
  wireframe,
  autoRotate,
}: {
  url: string;
  wireframe: boolean;
  autoRotate: boolean;
}) {
  // useGLTF suspends until the model is loaded.
  const gltf = useGLTF(url);
  // Clone so multiple viewers don't share mutable material state and so
  // wireframe flipping doesn't stick on cached instances.
  const scene = useMemo(() => gltf.scene.clone(true), [gltf.scene]);
  useWireframe(scene, wireframe);

  const groupRef = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.6;
    }
  });

  return (
    <group ref={groupRef}>
      <primitive object={scene} />
    </group>
  );
}

function LoadingFallback() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-foreground pointer-events-none">
      <Loader2 className="w-6 h-6 animate-spin text-rose-400" />
      <span className="text-md">Loading model...</span>
    </div>
  );
}

function ErrorFallback({ error }: { error: Error }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center p-8">
      <Box className="w-12 h-12 text-rose-400/40" />
      <p className="typo-body text-foreground">Could not load model</p>
      <p className="text-md text-foreground max-w-sm font-mono break-all">{error.message}</p>
    </div>
  );
}

/**
 * Drei's `useGLTF` throws to Suspense on success but turns into a render-time
 * throw on failure; `<Canvas>` needs an error boundary to keep the whole
 * Gallery3D modal from tearing.
 */
import { Component, type ReactNode, type ErrorInfo } from 'react';
class ViewerErrorBoundary extends Component<{ children: ReactNode; fallback: (err: Error) => ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(_err: Error, _info: ErrorInfo) {
    // keep silent — rendered fallback already tells the user
  }
  render() {
    if (this.state.error) return this.props.fallback(this.state.error);
    return this.props.children;
  }
}

export default function ThreeViewer({
  filePath,
  wireframe,
  autoRotate,
  lightingPreset,
}: ThreeViewerProps) {
  // Tauri serves local files through its protocol — convertFileSrc returns
  // a URL the fetch() inside GLTFLoader can consume.
  const url = useMemo(() => convertFileSrc(filePath), [filePath]);

  return (
    <div className="relative w-full h-full">
      <ViewerErrorBoundary fallback={(err) => <ErrorFallback error={err} />}>
        <Canvas
          camera={{ position: [2.5, 2, 4], fov: 40 }}
          dpr={[1, 2]}
          gl={{ antialias: true, preserveDrawingBuffer: false }}
          className="!absolute inset-0"
        >
          <Suspense fallback={null}>
            <color attach="background" args={['#0a0a0d']} />
            <Environment preset={ENV_PRESET[lightingPreset]} background={false} />
            <Stage
              intensity={lightingPreset === 'soft' ? 0.35 : 0.55}
              environment={null}
              shadows={{ type: 'accumulative', color: '#000', opacity: 0.4 }}
              adjustCamera={false}
            >
              <Bounds fit clip observe margin={1.2}>
                <ModelScene url={url} wireframe={wireframe} autoRotate={autoRotate} />
              </Bounds>
            </Stage>
            <OrbitControls
              enableDamping
              dampingFactor={0.08}
              minDistance={0.5}
              maxDistance={50}
              makeDefault
            />
            <CameraResetOnChange />
          </Suspense>
        </Canvas>
      </ViewerErrorBoundary>
      <Suspense fallback={<LoadingFallback />}>
        <InvisibleProbe url={url} />
      </Suspense>
    </div>
  );
}

/**
 * Reset the camera distance when the model changes so zoom from a previous
 * model doesn't persist.
 */
function CameraResetOnChange() {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(2.5, 2, 4);
    camera.lookAt(0, 0, 0);
  }, [camera]);
  return null;
}

/**
 * Probe that participates in the outer Suspense only — it triggers the
 * loading spinner outside Canvas. useGLTF is cached so the Canvas scene
 * resolves synchronously after this resolves.
 */
function InvisibleProbe({ url }: { url: string }) {
  useGLTF(url);
  return null;
}
