import { useSyncExternalStore } from 'react';
import {
  getDocumentVisible,
  subscribeDocumentVisibility,
} from '@/lib/documentVisibility';

export function useDocumentVisibility(): boolean {
  return useSyncExternalStore(
    subscribeDocumentVisibility,
    getDocumentVisible,
    () => true,
  );
}

