import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Manages terminal resize-by-drag, fullscreen toggle, and related keyboard shortcuts.
 */
export function useTerminalResize() {
  const [terminalHeight, setTerminalHeight] = useState(400);
  const [isTerminalFullscreen, setIsTerminalFullscreen] = useState(false);
  const isDraggingTerminal = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);
  const dragListenersRef = useRef<{ onMove: (e: MouseEvent) => void; onUp: () => void } | null>(null);

  const handleTerminalResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingTerminal.current = true;
    dragStartY.current = e.clientY;
    dragStartHeight.current = terminalHeight;

    const onMove = (moveEvent: MouseEvent) => {
      if (!isDraggingTerminal.current) return;
      const delta = moveEvent.clientY - dragStartY.current;
      setTerminalHeight(Math.max(120, Math.min(900, dragStartHeight.current + delta)));
    };

    const onUp = () => {
      isDraggingTerminal.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      dragListenersRef.current = null;
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    dragListenersRef.current = { onMove, onUp };
  }, [terminalHeight]);

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      if (dragListenersRef.current) {
        document.removeEventListener('mousemove', dragListenersRef.current.onMove);
        document.removeEventListener('mouseup', dragListenersRef.current.onUp);
        dragListenersRef.current = null;
      }
    };
  }, []);

  const toggleTerminalFullscreen = useCallback(() => setIsTerminalFullscreen(prev => !prev), []);

  // Escape key exits fullscreen
  useEffect(() => {
    if (!isTerminalFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsTerminalFullscreen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isTerminalFullscreen]);

  return {
    terminalHeight,
    isTerminalFullscreen,
    handleTerminalResizeStart,
    toggleTerminalFullscreen,
  };
}
