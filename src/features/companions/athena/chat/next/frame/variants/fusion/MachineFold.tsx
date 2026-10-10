/**
 * Fusion · a turn's machine rows, summarised. At rest: one short tick per
 * row, coloured by kind (`MACHINE_TONE`), behind a chip that says it in words
 * ("3 steps", a chevron); the ticks are the secondary cue. Pressed, the chip
 * opens IN PLACE into the rows themselves, each through Current's own
 * renderers (`AthenaChatCanvasNote` for a canvas readback, `AthenaChatSystemNote`
 * for a lookup, a fleet event or a dispatcher note), so what she looked up is
 * one click away and never noise in the conversation.
 *
 * TODO(prototype, 2026-10-07): athena chat fusion - consolidate after the owner picks.
 */

import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { useId, useState } from 'react';
import Button from '@/features/shared/components/buttons/Button';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { AthenaChatCanvasNote } from '../../../../AthenaChatCanvasNote';
import { AthenaChatSystemNote } from '../../../../AthenaChatSystemNote';
import { parseCanvasNote } from '../../../../athenaChatCanvasSummary';
import { MACHINE_TONE, type MachineRow } from '../../../exchange';
import { FUSION_COPY as F } from './copy';
import { EASE } from './text';

const SHOWN = 12;

export function MachineFold({ rows, index }: { rows: MachineRow[]; index: number }) {
  const { shouldAnimate } = useMotion();
  const [open, setOpen] = useState(false);
  const rowsId = useId();
  if (rows.length === 0) return null;
  const shown = rows.slice(0, SHOWN);
  const extra = rows.length - shown.length;
  return (
    <>
      <Button
        variant="ghost"
        size="xs"
        className="fu-ticks"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={rowsId}
        aria-label={F.machine(rows.length)}
        data-testid="companion-fusion-machine"
      >
        <ChevronRight className="fu-ticks-chev" aria-hidden />
        <span className="typo-caption fu-ticks-n">{F.steps(rows.length)}</span>
        <span className="fu-tickset" aria-hidden>
          {shown.map((m) => (
            <i key={m.id} style={{ ['--c' as string]: MACHINE_TONE[m.kind] }} />
          ))}
          {extra > 0 && <span className="typo-caption fu-ticks-n">{F.more(extra)}</span>}
        </span>
      </Button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="rows"
            id={rowsId}
            className="fu-machine-rows"
            data-testid="companion-fusion-machine-rows"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: shouldAnimate ? 0.26 : 0, ease: EASE }}
          >
            {rows.map((m, i) => {
              const canvas = m.kind === 'canvas' ? parseCanvasNote(m.content) : null;
              return canvas ? (
                <AthenaChatCanvasNote key={m.id} note={canvas} />
              ) : (
                <AthenaChatSystemNote key={m.id} content={m.content} compact index={index * 100 + i} />
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
