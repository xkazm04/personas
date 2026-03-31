import { useState, useCallback } from 'react';

export interface ModelViewerState {
  selectedModelPath: string | null;
  wireframe: boolean;
  autoRotate: boolean;
  lightingPreset: 'studio' | 'outdoor' | 'soft';
}

export function useModelViewer() {
  const [state, setState] = useState<ModelViewerState>({
    selectedModelPath: null,
    wireframe: false,
    autoRotate: true,
    lightingPreset: 'studio',
  });

  const selectModel = useCallback((path: string | null) => {
    setState((s) => ({ ...s, selectedModelPath: path }));
  }, []);

  const toggleWireframe = useCallback(() => {
    setState((s) => ({ ...s, wireframe: !s.wireframe }));
  }, []);

  const toggleAutoRotate = useCallback(() => {
    setState((s) => ({ ...s, autoRotate: !s.autoRotate }));
  }, []);

  const setLightingPreset = useCallback((preset: ModelViewerState['lightingPreset']) => {
    setState((s) => ({ ...s, lightingPreset: preset }));
  }, []);

  return {
    ...state,
    selectModel,
    toggleWireframe,
    toggleAutoRotate,
    setLightingPreset,
  };
}
