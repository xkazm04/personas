type VisibilityListener = (visible: boolean) => void;

const listeners = new Set<VisibilityListener>();

function readVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState === 'visible';
}

function notify(): void {
  const visible = readVisible();
  for (const listener of listeners) listener(visible);
}

let installed = false;

function ensureInstalled(): void {
  if (installed || typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', notify);
  installed = true;
}

export function getDocumentVisible(): boolean {
  return readVisible();
}

export function subscribeDocumentVisibility(listener: VisibilityListener): () => void {
  ensureInstalled();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

