// Canvas text notes: world-space multi-line text in the user's chosen font +
// size (they scale with zoom, like Figma text on canvas). In edit/note mode a
// note is draggable (pointer capture, like groups) and a plain click opens the
// editor. Rendering is pure; interaction is self-contained.
import { useRef } from 'react';

import { mix, NOTE_FONT } from './ink';
import { NOTE_SIZE_PX } from './notes';
import type { CanvasMode, CanvasNote } from './types';

export function NoteLayer({ notes, z, mode, onNotesChange, onEdit }: {
  notes: CanvasNote[];
  z: number;
  mode: CanvasMode;
  onNotesChange: (next: CanvasNote[], persist: boolean) => void;
  onEdit: (id: string) => void;
}) {
  const drag = useRef<{ id: number; noteId: string; sx: number; sy: number; ox: number; oy: number; z: number; moved: boolean } | null>(null);
  const interactive = mode === 'edit' || mode === 'note';

  const begin = (e: React.PointerEvent<SVGGElement>, n: CanvasNote) => {
    if (!interactive || e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, noteId: n.id, sx: e.clientX, sy: e.clientY, ox: n.x, oy: n.y, z, moved: false };
  };
  const move = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
    if (d.moved) {
      onNotesChange(notes.map((n) => (n.id === d.noteId ? { ...n, x: d.ox + (e.clientX - d.sx) / d.z, y: d.oy + (e.clientY - d.sy) / d.z } : n)), false);
    }
  };
  const end = (e: React.PointerEvent<SVGGElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      onNotesChange(notes.map((n) => (n.id === d.noteId ? { ...n, x: d.ox + (e.clientX - d.sx) / d.z, y: d.oy + (e.clientY - d.sy) / d.z } : n)), true);
    } else {
      onEdit(d.noteId);
    }
  };

  return (
    <g>
      {notes.map((n) => {
        const fs = NOTE_SIZE_PX[n.size];
        const lines = n.text.split('\n');
        return (
          <g
            key={n.id}
            transform={`translate(${n.x} ${n.y})`}
            style={interactive ? { cursor: 'move' } : undefined}
            onPointerDown={(e) => begin(e, n)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            data-testid={`mm-note-${n.id}`}
          >
            {/* generous invisible hit area so short notes stay grabbable */}
            <rect
              x={-8} y={-fs} width={Math.max(60, ...lines.map((l) => l.length * fs * 0.6)) + 16} height={lines.length * fs * 1.25 + 12}
              fill="transparent"
            />
            <text fontFamily={NOTE_FONT[n.font]} fontSize={fs} fill={mix('var(--foreground)', 92)}>
              {lines.map((line, i) => (
                <tspan key={i} x={0} dy={i === 0 ? 0 : fs * 1.25}>{line || ' '}</tspan>
              ))}
            </text>
          </g>
        );
      })}
    </g>
  );
}
