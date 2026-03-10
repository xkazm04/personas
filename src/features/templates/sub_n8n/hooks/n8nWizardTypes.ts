import type { MutableRefObject } from 'react';
import type { ConfirmResult } from '../steps/confirm/N8nConfirmStep';
import type { N8nImportAction, N8nImportState } from './useN8nImportReducer';

export interface WizardDeps {
  state: N8nImportState;
  dispatch: (action: N8nImportAction) => void;
  transform: {
    currentTransformId: string | null;
    setAnalyzing: (v: boolean) => void;
    startTransformStream: (id: string) => Promise<void>;
    resetTransformStream: () => Promise<void>;
    setIsRestoring: (v: boolean) => void;
  };
  test: {
    startTestStream: (id: string) => Promise<void>;
    resetTestStream: () => Promise<void>;
  };
  session: {
    clearPersistedContext: () => void;
    remove: () => void;
  };
  setN8nTransformActive: (v: boolean) => void;
  fetchPersonas: () => Promise<void>;
  selectPersona: (id: string) => void;
  setConfirmResult: (r: ConfirmResult | null) => void;
  transformLockRef: MutableRefObject<boolean>;
  confirmingRef: MutableRefObject<boolean>;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
}
